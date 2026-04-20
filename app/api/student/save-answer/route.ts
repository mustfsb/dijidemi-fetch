import { NextRequest, NextResponse } from 'next/server';
import type { SaveAnswerRequest, UserAnswers } from '@/types';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import {
    readBufferedUpstreamPayload,
    requestUpstreamApi,
    UPSTREAM_API_DEFAULTS,
} from '@/lib/upstreamApi';

interface SaveAnswerResponse {
    success?: boolean;
    raw?: string;
    error?: string;
}

const NUMERIC_ID_PATTERN = /^\d+$/;
const ANSWER_CHAR_PATTERN = /^[A-EO ]$/;

function normalizeNumericQueryValue(value: unknown, field: string): string | NextResponse<SaveAnswerResponse> {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized.length > 64 || !NUMERIC_ID_PATTERN.test(normalized)) {
        return NextResponse.json({ error: `Geçersiz ${field}` }, { status: 400 });
    }
    return normalized;
}

function normalizeAnswerChar(value: unknown): string {
    if (typeof value !== 'string') {
        return ' ';
    }

    const normalized = value.trim().toUpperCase();
    const char = normalized ? normalized[0] : ' ';
    return ANSWER_CHAR_PATTERN.test(char) ? char : ' ';
}

export async function POST(request: NextRequest): Promise<NextResponse<SaveAnswerResponse>> {
    try {
        // Auth check
        const auth = await requireAuth(request);
        if (auth instanceof NextResponse) return auth;

        // Rate limit
        const ip = getClientIp(request);
        if (!(await RateLimits.GENERAL(ip, auth.userId))) {
            return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
        }

        let body: SaveAnswerRequest;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Geçersiz JSON gövdesi' }, { status: 400 });
        }
        const {
            testId,
            answers,
            totalQuestions,
            dersId = Number(UPSTREAM_API_DEFAULTS.dersId),
            odevId = Number(UPSTREAM_API_DEFAULTS.odevId),
            turId = Number(UPSTREAM_API_DEFAULTS.turId),
        } = body;
        if (!testId || typeof testId !== 'string' || testId.length > 64) {
            return NextResponse.json({ error: 'Geçersiz testId' }, { status: 400 });
        }
        if (!answers || typeof answers !== 'object') {
            return NextResponse.json({ error: 'Geçersiz answers alanı' }, { status: 400 });
        }
        const limit = totalQuestions || 40;
        if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
            return NextResponse.json({ error: 'Geçersiz totalQuestions' }, { status: 400 });
        }

        const normalizedTestId = normalizeNumericQueryValue(testId, 'testId');
        if (normalizedTestId instanceof NextResponse) return normalizedTestId;
        const normalizedDersId = normalizeNumericQueryValue(dersId, 'dersId');
        if (normalizedDersId instanceof NextResponse) return normalizedDersId;
        const normalizedOdevId = normalizeNumericQueryValue(odevId, 'odevId');
        if (normalizedOdevId instanceof NextResponse) return normalizedOdevId;
        const normalizedTurId = normalizeNumericQueryValue(turId, 'turId');
        if (normalizedTurId instanceof NextResponse) return normalizedTurId;

        // 1. Construct Answer String
        let answersString = "";
        for (let i = 1; i <= limit; i++) {
            answersString += normalizeAnswerChar(answers[i]);
        }

        const response = await requestUpstreamApi({
            path: '/api/save-answers',
            method: 'GET',
            query: {
                dersId: normalizedDersId,
                odevId: normalizedOdevId,
                testId: normalizedTestId,
                turId: normalizedTurId,
                cevaplar: answersString,
            },
        });
        if (response instanceof NextResponse) return response;

        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to save answers' }, { status: response.status });
        }

        const payload = readBufferedUpstreamPayload(response);
        return NextResponse.json({
            success: true,
            raw: typeof payload === 'string' ? payload : JSON.stringify(payload),
        });

    } catch (error) {
        console.error('Save Answer Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
        return NextResponse.json({ error: 'Cevap kaydedilirken hata oluştu.' }, { status: 500 });
    }
}
