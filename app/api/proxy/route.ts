import { NextRequest, NextResponse } from 'next/server';
import {
    getClientIp,
} from '@/lib/auth';
import {
    readBufferedUpstreamPayload,
    requestUpstreamApi,
    UPSTREAM_API_DEFAULTS,
} from '@/lib/upstreamApi';
import { RateLimits } from '@/lib/rate-limit';

export const maxDuration = 25;

const NUMERIC_ID_PATTERN = /^\d+$/;

function parseNumericParam(value: string | null, field: string): string | NextResponse {
    const normalized = value?.trim() || '';
    if (!normalized || !NUMERIC_ID_PATTERN.test(normalized)) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
    }
    return normalized;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
    const ip = getClientIp(request);
    if (!(await RateLimits.GENERAL(ip))) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const testId = parseNumericParam(searchParams.get('testId'), 'testId');
    if (testId instanceof NextResponse) return testId;
    const programId = parseNumericParam(searchParams.get('programId') || UPSTREAM_API_DEFAULTS.programId, 'programId');
    if (programId instanceof NextResponse) return programId;

    try {
        const response = await requestUpstreamApi({
            path: '/api/test',
            method: 'GET',
            query: {
                testId,
                programId,
            },
        });
        if (response instanceof NextResponse) return response;

        if (!response.ok) {
            throw new Error(`Upstream API responded with ${response.status}`);
        }

        const data = readBufferedUpstreamPayload(response);
        return NextResponse.json(data);

    } catch (error) {
        console.error('Proxy Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 500 });
    }

}
