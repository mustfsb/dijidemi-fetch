import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { supabase } from '@/lib/db/supabase';
import { getClientIp } from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { RateLimits } from '@/lib/rate-limit';

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

async function fetchKttData(request: NextRequest, testId: string, programId: string): Promise<KttData | NextResponse> {
    const base = 'https://www.dijidemi.com/MobilService/GetTestById';

    // Try same combinations as proxy, testTur=1 first (matches /api/proxy default)
    const urls = [
        `${base}?testId=${encodeURIComponent(testId)}&programId=${encodeURIComponent(programId)}&testTur=1`,
        `${base}?testId=${encodeURIComponent(testId)}&programId=${encodeURIComponent(programId)}&testTur=2`,
        `${base}?testId=${encodeURIComponent(testId)}&testTur=1`,
        `${base}?testId=${encodeURIComponent(testId)}`,
    ];

    let lastError = '';
    let bestData: Record<string, unknown> | null = null;
    let bestTitle = '';
    let bestAnswerKey = '';

    for (const url of urls) {
        let response;
        try {
            response = await requestDijidemiUpstream({
                request,
                url,
                method: 'GET',
            });
        } catch (err: any) {
            lastError = err.message;
            continue;
        }

        if (response instanceof NextResponse) {
            return response;
        }

        if (!response.ok) {
            lastError = `HTTP ${response.status}`;
            continue;
        }

        let data: Record<string, unknown>;
        try {
            data = await response.json();
        } catch {
            lastError = 'JSON parse error';
            continue;
        }

        const title = extractTitle(data);
        const answerKey = extractAnswerKey(data);

        // Keep the best result (has both title and answer key)
        if (title && answerKey) {
            const resolvedId = String(data.TestId || data.testId || data.Id || testId);
            return {
                resolvedTestId: resolvedId,
                title,
                answerKey,
                questionCount: (typeof data.SoruSayisi === 'number' ? data.SoruSayisi : answerKey.length) || 0,
                raw: data,
            };
        }

        // Partial match: has at least a title
        if (title && !bestTitle) {
            bestTitle = title;
            bestAnswerKey = answerKey;
            bestData = data;
        }

        // Partial match: has at least an answer key
        if (answerKey && !bestAnswerKey) {
            bestAnswerKey = answerKey;
            if (!bestData) bestData = data;
        }

        if (!bestData) bestData = data;
    }

    if (bestData) {
        const title = bestTitle || `KTT #${testId}`;
        const answerKey = bestAnswerKey;
        const resolvedId = String(bestData.TestId || bestData.testId || bestData.Id || testId);
        return {
            resolvedTestId: resolvedId,
            title,
            answerKey,
            questionCount: (typeof bestData.SoruSayisi === 'number' ? bestData.SoruSayisi : answerKey.length) || 0,
            raw: bestData,
        };
    }

    throw new Error(`GetTestById başarısız (${lastError || 'yanıt yok'}). testId: ${testId}`);
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
    const testId = searchParams.get('testId');
    const programId = searchParams.get('programId') || '14308';

    if (!testId) {
        return NextResponse.json({ success: false, error: 'Missing testId' }, { status: 400 });
    }

    try {
        const ktt = await fetchKttData(request, testId, programId);
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
        const testId = String(body?.testId || '').trim();
        const programId = String(body?.programId || '14308');
        const save = Boolean(body?.save);

        if (!testId) {
            return NextResponse.json({ success: false, error: 'Missing testId' }, { status: 400 });
        }

        const ktt = await fetchKttData(request, testId, programId);
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
