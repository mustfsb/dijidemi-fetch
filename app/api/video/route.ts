import { NextRequest, NextResponse } from 'next/server';
import type { VideoResponse } from '@/types';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import {
    extractVideoUrlFromPayload,
    readBufferedUpstreamPayload,
    requestUpstreamApi,
} from '@/lib/upstreamApi';

export const maxDuration = 25;

const NUMERIC_ID_PATTERN = /^\d+$/;

function parseNumericParam(value: string | null, field: string): string | NextResponse {
    const normalized = value?.trim() || '';
    if (!normalized || !NUMERIC_ID_PATTERN.test(normalized)) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
    }
    return normalized;
}

export async function GET(request: NextRequest) {
    // Auth check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Rate limit
    const ip = getClientIp(request);
    if (!(await RateLimits.GENERAL(ip, auth.userId))) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const testId = parseNumericParam(searchParams.get('testId'), 'testId');
    if (testId instanceof NextResponse) return testId;
    const soruId = parseNumericParam(searchParams.get('soruId'), 'soruId');
    if (soruId instanceof NextResponse) return soruId;

    try {
        const response = await requestUpstreamApi({
            path: '/api/video',
            method: 'POST',
            json: {
                testId: Number(testId),
                soruId: Number(soruId),
            },
        });
        if (response instanceof NextResponse) return response;

        if (!response.ok) {
            return NextResponse.json({ error: `Upstream error: ${response.status}` }, { status: response.status });
        }

        const payload = readBufferedUpstreamPayload(response);
        const payloadRecord = (
            payload
            && typeof payload === 'object'
            && !Array.isArray(payload)
        ) ? payload as Record<string, unknown> : null;
        const videoUrl = extractVideoUrlFromPayload(payload);

        if (videoUrl) {
            return NextResponse.json({
                success: true,
                videoUrl: videoUrl,
                testId,
                soruId
            });
        } else {
            const message = typeof payloadRecord?.message === 'string'
                ? payloadRecord.message
                : 'Video not found';

            return NextResponse.json({
                success: false,
                message,
            });
        }

    } catch (error) {
        console.error('Video Proxy Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

}
