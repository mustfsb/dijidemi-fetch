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

    const url = 'https://www.dijidemi.com/Ogrenci2020/Video?___layout';
    const body = new URLSearchParams({
        tur: '2',
        sinavId: '0',
        sinavTuru: '2',
        testId,
        soruId,
    }).toString();

    try {
        const response = await requestDijidemiUpstream({
            request,
            userId: auth.userId,
            url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            body,
            referrer: 'https://www.dijidemi.com/Ogrenci2020',
        });
        if (response instanceof NextResponse) return response;

        if (!response.ok) {
            return NextResponse.json({ error: `Upstream error: ${response.status}` }, { status: response.status });
        }

        const html = await response.text();
        let videoUrl: string | null = null;

        const videoSrcMatch = html.match(/<video[^>]*src="([^"]+)"/i);
        if (videoSrcMatch) videoUrl = videoSrcMatch[1];

        if (!videoUrl) {
            const sourceSrcMatch = html.match(/<source[^>]*src="([^"]+)"/i);
            if (sourceSrcMatch) videoUrl = sourceSrcMatch[1];
        }

        if (!videoUrl) {
            const mp4Match = html.match(/"([^"]+\.mp4)"/);
            if (mp4Match) videoUrl = mp4Match[1];
        }

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
