import { NextRequest, NextResponse } from 'next/server';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { verifyPrivateTestApiRequest } from '@/lib/private-test/device-gate';
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

    const deviceGate = await verifyPrivateTestApiRequest(request, auth.userId);
    if (deviceGate.status !== 'ok') {
        return NextResponse.json({ error: 'device_not_bound' }, { status: 403 });
    }

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
        const videoUrl = extractVideoUrlFromPayload(payload);

        if (videoUrl) {
            return NextResponse.json({
                success: true,
                videoUrl,
                testId,
                soruId,
            });
        }

        return NextResponse.json({
            success: false,
            message: 'Video not found',
        });
    } catch (error) {
        console.error('Private Video Proxy Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

}
