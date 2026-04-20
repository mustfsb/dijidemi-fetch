import { NextRequest, NextResponse } from 'next/server';
import {
    getClientIp,
} from '@/lib/auth';
import {
    readBufferedUpstreamPayload,
    requestUpstreamApi,
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

    // Direct passthrough: GET http://194.62.55.93:8000/api/test?testId=<id>
    const response = await requestUpstreamApi({
        path: '/api/test',
        method: 'GET',
        query: { testId },
    });

    if (response instanceof NextResponse) return response;

    if (!response.ok) {
        console.error(`[proxy] upstream ${response.status} for testId=${testId}`);
        return NextResponse.json({ error: `Upstream ${response.status}` }, { status: response.status });
    }

    const data = readBufferedUpstreamPayload(response);
    return NextResponse.json(data);
}
