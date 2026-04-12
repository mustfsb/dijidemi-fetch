import { NextRequest, NextResponse } from 'next/server';
import {
    getClientIp,
} from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import {
    readBufferedUpstreamPayload,
    requestUpstreamApi,
    UPSTREAM_API_DEFAULTS,
} from '@/lib/upstreamApi';

interface TestAnswersResponse {
    success: boolean;
    ogCevaplar?: string;
    tCevaplar?: string;
    dogru?: number;
    yanlis?: number;
    bos?: number;
    net?: number;
    hasAnswers?: boolean;
    error?: string;
}

interface DijidemiTestAnswersPayload {
    Success?: boolean;
    ogCevaplar?: string;
    tCevaplar?: string;
}

const NUMERIC_ID_PATTERN = /^\d+$/;

function parseNumericParam(value: string | null, field: string): string | NextResponse<TestAnswersResponse> {
    const normalized = value?.trim() || '';
    if (!normalized || !NUMERIC_ID_PATTERN.test(normalized)) {
        return NextResponse.json({ success: false, error: `${field} parametresi geçersiz` }, { status: 400 });
    }
    return normalized;
}

export const maxDuration = 25;

export async function GET(request: NextRequest): Promise<NextResponse<TestAnswersResponse>> {
    const ip = getClientIp(request);
    console.log(`[test-answers] GET from ip=${ip}`);
    if (!(await RateLimits.GENERAL(ip))) {
        return NextResponse.json({ success: false, error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const testId = parseNumericParam(searchParams.get('testId'), 'testId');
    if (testId instanceof NextResponse) return testId;
    const turID = parseNumericParam(searchParams.get('turID') || '2', 'turID');
    if (turID instanceof NextResponse) return turID;

    try {
        const response = await requestUpstreamApi({
            path: '/api/test-answers',
            method: 'GET',
            query: {
                testId,
                turID: turID || UPSTREAM_API_DEFAULTS.turID,
            },
        });

        // Upstream unreachable or transport error — degrade gracefully
        if (response instanceof NextResponse) {
            console.warn(`[test-answers] upstream transport error for testId=${testId}`);
            return NextResponse.json({ success: true, hasAnswers: false });
        }

        if (!response.ok) {
            console.warn(`[test-answers] upstream HTTP ${response.status} for testId=${testId}, body snippet: ${response.body.slice(0, 200)}`);
            return NextResponse.json({ success: true, hasAnswers: false });
        }

        const payload = readBufferedUpstreamPayload(response);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return NextResponse.json({
                success: false,
                error: 'Beklenmeyen API yanıtı'
            }, { status: 502 });
        }

        const data = payload as DijidemiTestAnswersPayload;

        if (!data.Success) {
            return NextResponse.json({
                success: false,
                error: 'API başarısız yanıt döndü'
            });
        }

        const ogCevaplar: string = data.ogCevaplar || '';
        const tCevaplar: string = data.tCevaplar || '';

        // Check if student has any answers (not all "O")
        const allEmpty = ogCevaplar.split('').every(c => c === 'O');

        if (allEmpty) {
            return NextResponse.json({
                success: true,
                ogCevaplar,
                tCevaplar,
                hasAnswers: false,
                dogru: 0,
                yanlis: 0,
                bos: ogCevaplar.length,
                net: 0
            });
        }

        // Calculate scores
        let dogru = 0;
        let yanlis = 0;
        let bos = 0;

        for (let i = 0; i < ogCevaplar.length && i < tCevaplar.length; i++) {
            const studentAnswer = ogCevaplar[i];
            const correctAnswer = tCevaplar[i];

            if (studentAnswer === 'O') {
                bos++;
            } else if (studentAnswer === correctAnswer) {
                dogru++;
            } else {
                yanlis++;
            }
        }

        // Calculate net (Doğru - Yanlış/4)
        const net = dogru - (yanlis / 4);

        return NextResponse.json({
            success: true,
            ogCevaplar,
            tCevaplar,
            hasAnswers: true,
            dogru,
            yanlis,
            bos,
            net: Math.round(net * 100) / 100 // Round to 2 decimal places
        });

    } catch (error) {
        console.error('Test Answers API Error:', error);
        return NextResponse.json({
            success: false,
            error: 'Sunucu hatası oluştu'
        }, { status: 500 });
    }
}
