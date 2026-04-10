import { NextRequest, NextResponse } from 'next/server';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { verifyPrivateTestApiRequest } from '@/lib/private-test/device-gate';
import { RateLimits } from '@/lib/rate-limit';

const NUMERIC_ID_PATTERN = /^\d+$/;

function parseNumericParam(value: string | null, field: string): string | NextResponse {
    const normalized = value?.trim() || '';
    if (!normalized || !NUMERIC_ID_PATTERN.test(normalized)) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
    }
    return normalized;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
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
    const programId = parseNumericParam(searchParams.get('programId') || '14308', 'programId');
    if (programId instanceof NextResponse) return programId;
    const testTur = parseNumericParam(searchParams.get('testTur') || '1', 'testTur');
    if (testTur instanceof NextResponse) return testTur;

    const baseUrl = 'https://www.dijidemi.com/MobilService/GetTestById';
    const params = new URLSearchParams({
        testId,
        programId,
        testTur,
    });
    const url = `${baseUrl}?${params.toString()}`;

    console.log(`Private proxy request for testId: ${testId}`);

    try {
        const response = await requestDijidemiUpstream({
            request,
            userId: auth.userId,
            url,
            method: 'GET',
        });
        if (response instanceof NextResponse) return response;

        if (!response.ok) {
            throw new Error(`Upstream API responded with ${response.status}`);
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Private Proxy Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 500 });
    }
}
