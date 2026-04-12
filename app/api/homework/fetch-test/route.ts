import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { supabase } from '@/lib/db/supabase';
import { getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import {
    readBufferedUpstreamPayload,
    requestUpstreamApi,
    UPSTREAM_API_DEFAULTS,
} from '@/lib/upstreamApi';

export const maxDuration = 25;

const NUMERIC_ID_PATTERN = /^\d+$/;

type KttData = {
    resolvedTestId: string;
    title: string;
    answerKey: string;
    questionCount: number;
    raw: Record<string, unknown>;
};

async function requireAdmin() {
    const supabaseSSR = await createAdminClient();
    const { data: { user }, error: authError } = await supabaseSSR.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const username = user.user_metadata?.username;
    if (!username) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { data: adminRef, error: adminError } = await supabase
        .from('admin')
        .select('role')
        .eq('username', username)
        .single();

    if (adminError || adminRef?.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    return { user, username };
}

function parseNumericParam(value: unknown, field: string): string | NextResponse {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 64 || !NUMERIC_ID_PATTERN.test(normalized)) {
        return NextResponse.json({ success: false, error: `Geçersiz ${field}` }, { status: 400 });
    }
    return normalized;
}

function extractTitle(data: Record<string, unknown>): string {
    // Proxy (private-test/page.tsx) uses data.Adi || data.TestAdi — same order here
    const candidates = [
        data?.Adi,
        data?.TestAdi,
        data?.testAdi,
        data?.Test,
        data?.Baslik,
        data?.baslik,
    ];
    for (const v of candidates) {
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
}

function extractAnswerKey(data: Record<string, unknown>): string {
    // useTestRunner.ts resolveAnswerKey logic
    const candidateKeys = [
        'CevapAnahtari', 'cevapAnahtari',
        'DogruCevaplar', 'dogruCevaplar',
        'Cevaplar', 'cevaplar',
        'tCevaplar', 'TCevaplar',
    ];
    for (const key of candidateKeys) {
        const val = data[key];
        if (typeof val === 'string') {
            const cleaned = val.toUpperCase().replace(/[^A-EO]/g, '');
            if (cleaned.length >= 5) return cleaned;
        }
    }
    // Last resort: scan all values
    for (const val of Object.values(data)) {
        if (typeof val === 'string') {
            const cleaned = val.toUpperCase().replace(/[^A-EO]/g, '');
            if (cleaned.length >= 10) return cleaned;
        }
    }
    return '';
}

async function fetchKttData(testId: string, programId: string): Promise<KttData | NextResponse> {
    const response = await requestUpstreamApi({
        path: '/api/test',
        method: 'GET',
        query: {
            testId,
            programId,
        },
    });

    if (response instanceof NextResponse) {
        return response;
    }

    if (!response.ok) {
        throw new Error(`Test verisi alınamadı (HTTP ${response.status}). testId: ${testId}`);
    }

    const payload = readBufferedUpstreamPayload(response);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`Beklenmeyen test yanıtı. testId: ${testId}`);
    }

    const data = payload as Record<string, unknown>;
    const title = extractTitle(data) || `KTT #${testId}`;
    const answerKey = extractAnswerKey(data);
    const resolvedId = String(data.TestId || data.testId || data.Id || testId);

    return {
        resolvedTestId: resolvedId,
        title,
        answerKey,
        questionCount: (typeof data.SoruSayisi === 'number' ? data.SoruSayisi : answerKey.length) || 0,
        raw: data,
    };
}

async function insertOrUpdateKttHomework(ktt: KttData) {
    const homeworkId = ktt.resolvedTestId;

    const { data: existingRows, error: existingError } = await supabase
        .from('homeworks')
        .select('id')
        .eq('homework_identifier', homeworkId)
        .order('created_at', { ascending: false })
        .limit(1);

    if (existingError) throw new Error(existingError.message);

    const existing = existingRows?.[0];
    const description = `Başlık: ${ktt.title}`;

    const basePayload = {
        homework_identifier: homeworkId,
        description,
        status: 'active',
        updated_at: new Date().toISOString(),
    };
    const payloadWithType = { ...basePayload, type: 'ktt' };

    if (existing?.id) {
        let { data: homeworkData, error } = await supabase
            .from('homeworks')
            .update(payloadWithType)
            .eq('id', existing.id)
            .select()
            .single();

        if (error?.code === '42703') {
            ({ data: homeworkData, error } = await supabase
                .from('homeworks')
                .update(basePayload)
                .eq('id', existing.id)
                .select()
                .single());
        }

        if (error) throw new Error(error.message);
        return homeworkData;
    }

    let { data: homeworkData, error } = await supabase
        .from('homeworks')
        .insert([payloadWithType])
        .select()
        .single();

    if (error?.code === '42703') {
        ({ data: homeworkData, error } = await supabase
            .from('homeworks')
            .insert([basePayload])
            .select()
            .single());
    }

    if (error) throw new Error(error.message);
    return homeworkData;
}

export async function GET(request: NextRequest) {
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;

    const ip = getClientIp(request);
    if (!(await RateLimits.GENERAL(ip, admin.username))) {
        return NextResponse.json({ success: false, error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const testId = parseNumericParam(searchParams.get('testId'), 'testId');
    if (testId instanceof NextResponse) return testId;
    const programId = parseNumericParam(searchParams.get('programId') || UPSTREAM_API_DEFAULTS.programId, 'programId');
    if (programId instanceof NextResponse) return programId;

    try {
        const ktt = await fetchKttData(testId, programId);
        if (ktt instanceof NextResponse) return ktt;
        return NextResponse.json({
            success: true,
            testId: ktt.resolvedTestId,
            title: ktt.title,
            answerKey: ktt.answerKey,
            questionCount: ktt.questionCount,
        });
    } catch (error: any) {
        console.error('[fetch-test GET]', error.message);
        return NextResponse.json({ success: false, error: error.message || 'Fetch failed' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;

    const ip = getClientIp(request);
    if (!(await RateLimits.GENERAL(ip, admin.username))) {
        return NextResponse.json({ success: false, error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const testId = parseNumericParam(body?.testId, 'testId');
        if (testId instanceof NextResponse) return testId;
        const programId = parseNumericParam(body?.programId || UPSTREAM_API_DEFAULTS.programId, 'programId');
        if (programId instanceof NextResponse) return programId;
        const save = Boolean(body?.save);

        const ktt = await fetchKttData(testId, programId);
        if (ktt instanceof NextResponse) return ktt;

        if (!save) {
            return NextResponse.json({
                success: true,
                testId: ktt.resolvedTestId,
                title: ktt.title,
                answerKey: ktt.answerKey,
                questionCount: ktt.questionCount,
            });
        }

        const homework = await insertOrUpdateKttHomework(ktt);
        return NextResponse.json({
            success: true,
            testId: ktt.resolvedTestId,
            title: ktt.title,
            answerKey: ktt.answerKey,
            questionCount: ktt.questionCount,
            homework,
        });
    } catch (error: any) {
        console.error('[fetch-test POST]', error.message);
        return NextResponse.json({ success: false, error: error.message || 'KTT eklenemedi' }, { status: 500 });
    }

}
