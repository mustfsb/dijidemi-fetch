import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

const MAX_PROMPT_LENGTH = 5000;
const MAX_RESPONSE_LENGTH = 20000;
const MAX_TITLE_LENGTH = 100;
const MAX_IDS_LENGTH = 4000;
const MAX_MESSAGES = 200;

interface IdentityContext {
    primaryUsername: string;
    candidates: string[];
}

function safeString(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLength) return null;
    return trimmed;
}

async function resolveIdentity(userId: string): Promise<IdentityContext> {
    const candidates = new Set<string>([userId]);
    let primaryUsername = userId;

    const { data: userRecord } = await supabase
        .from('users')
        .select('username, external_id')
        .eq('id', userId)
        .maybeSingle();

    const username = typeof userRecord?.username === 'string' ? userRecord.username.trim() : '';
    const externalId = typeof userRecord?.external_id === 'string' ? userRecord.external_id.trim() : '';

    if (username) {
        primaryUsername = username;
        candidates.add(username);
    }
    if (externalId) {
        if (!username) primaryUsername = externalId;
        candidates.add(externalId);
    }

    return {
        primaryUsername,
        candidates: Array.from(candidates).slice(0, 8),
    };
}

function sanitizeMessages(value: unknown): unknown[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_MESSAGES);
}

export async function GET(request: NextRequest) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const ip = getClientIp(request);
    if (!RateLimits.GENERAL(ip, `playground-history:${auth.userId}`)) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    try {
        const identity = await resolveIdentity(auth.userId);
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');
        const limitRaw = Number.parseInt(searchParams.get('limit') || '50', 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 50;

        if (sessionId) {
            const { data, error } = await supabase
                .from('ai_log')
                .select('*')
                .eq('id', sessionId)
                .in('username', identity.candidates)
                .maybeSingle();

            if (error) throw error;
            if (!data) {
                return NextResponse.json({ error: 'Session not found' }, { status: 404 });
            }
            return NextResponse.json({ session: data });
        }

        const { data, error } = await supabase
            .from('ai_log')
            .select('id, session_title, title, user_prompt, image_ids, created_at')
            .in('username', identity.candidates)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return NextResponse.json({ sessions: data || [] });
    } catch (error) {
        console.error('[Playground History GET] Failed:', error);
        return NextResponse.json({ error: 'History fetch failed' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const ip = getClientIp(request);
    if (!RateLimits.GENERAL(ip, `playground-history:${auth.userId}`)) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    try {
        let body: any;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const userPrompt = safeString(body?.user_prompt, MAX_PROMPT_LENGTH);
        if (!userPrompt) {
            return NextResponse.json({ error: 'user_prompt is required' }, { status: 400 });
        }

        const sessionTitle = safeString(body?.session_title, MAX_TITLE_LENGTH) || userPrompt.slice(0, MAX_TITLE_LENGTH);
        const title = safeString(body?.title, MAX_TITLE_LENGTH) || sessionTitle;
        const aiResponse = typeof body?.ai_response === 'string'
            ? body.ai_response.slice(0, MAX_RESPONSE_LENGTH)
            : null;
        const questionIds = typeof body?.question_ids === 'string'
            ? body.question_ids.slice(0, MAX_IDS_LENGTH)
            : '';
        const imageIds = typeof body?.image_ids === 'string'
            ? body.image_ids.slice(0, MAX_IDS_LENGTH)
            : '';
        const sender = body?.sender === 'assistant' ? 'assistant' : 'user';
        const messages = sanitizeMessages(body?.messages);

        const identity = await resolveIdentity(auth.userId);

        const { data, error } = await supabase
            .from('ai_log')
            .insert([{
                username: identity.primaryUsername,
                user_prompt: userPrompt,
                ai_response: aiResponse,
                messages,
                question_ids: questionIds,
                image_ids: imageIds,
                session_title: sessionTitle,
                title,
                sender,
            }])
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ success: true, session: data });
    } catch (error) {
        console.error('[Playground History POST] Failed:', error);
        return NextResponse.json({ error: 'History save failed' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const ip = getClientIp(request);
    if (!RateLimits.GENERAL(ip, `playground-history:${auth.userId}`)) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    try {
        let body: any;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const sessionId = safeString(body?.id, 128);
        if (!sessionId) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const identity = await resolveIdentity(auth.userId);
        const { data: ownedSession } = await supabase
            .from('ai_log')
            .select('id')
            .eq('id', sessionId)
            .in('username', identity.candidates)
            .maybeSingle();

        if (!ownedSession) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        const updates: Record<string, unknown> = {};

        if (typeof body?.user_prompt === 'string') {
            const prompt = safeString(body.user_prompt, MAX_PROMPT_LENGTH);
            if (!prompt) return NextResponse.json({ error: 'Invalid user_prompt' }, { status: 400 });
            updates.user_prompt = prompt;
        }

        if (typeof body?.session_title === 'string') {
            const sessionTitle = safeString(body.session_title, MAX_TITLE_LENGTH);
            if (!sessionTitle) return NextResponse.json({ error: 'Invalid session_title' }, { status: 400 });
            updates.session_title = sessionTitle;
        }

        if (typeof body?.title === 'string') {
            const title = safeString(body.title, MAX_TITLE_LENGTH);
            if (!title) return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
            updates.title = title;
        }

        if (typeof body?.ai_response === 'string' || body?.ai_response === null) {
            updates.ai_response = typeof body.ai_response === 'string'
                ? body.ai_response.slice(0, MAX_RESPONSE_LENGTH)
                : null;
        }

        if (typeof body?.question_ids === 'string') {
            updates.question_ids = body.question_ids.slice(0, MAX_IDS_LENGTH);
        }

        if (typeof body?.image_ids === 'string') {
            updates.image_ids = body.image_ids.slice(0, MAX_IDS_LENGTH);
        }

        if (body?.sender === 'assistant' || body?.sender === 'user') {
            updates.sender = body.sender;
        }

        if (body?.messages !== undefined) {
            updates.messages = sanitizeMessages(body.messages);
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
        }

        const { error } = await supabase
            .from('ai_log')
            .update(updates)
            .eq('id', sessionId);

        if (error) throw error;
        return NextResponse.json({ success: true, id: sessionId });
    } catch (error) {
        console.error('[Playground History PATCH] Failed:', error);
        return NextResponse.json({ error: 'History update failed' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const ip = getClientIp(request);
    if (!RateLimits.GENERAL(ip, `playground-history:${auth.userId}`)) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const sessionId = safeString(searchParams.get('id'), 128);
        if (!sessionId) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const identity = await resolveIdentity(auth.userId);
        const { data: ownedSession } = await supabase
            .from('ai_log')
            .select('id')
            .eq('id', sessionId)
            .in('username', identity.candidates)
            .maybeSingle();

        if (!ownedSession) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        const { error } = await supabase
            .from('ai_log')
            .delete()
            .eq('id', sessionId);

        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Playground History DELETE] Failed:', error);
        return NextResponse.json({ error: 'History delete failed' }, { status: 500 });
    }
}
