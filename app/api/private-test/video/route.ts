import { NextRequest, NextResponse } from 'next/server';
import cookieManager from '@/lib/cookie/cookieManager';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
    // Auth check
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Rate limit
    const ip = getClientIp(request);
    if (!RateLimits.GENERAL(ip, auth.userId)) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const testId = searchParams.get('testId');
    const soruId = searchParams.get('soruId');

    if (!testId || !soruId) {
        return NextResponse.json({ error: 'Missing testId or soruId' }, { status: 400 });
    }

    const headers = await cookieManager.getHeaders();
    const url = 'https://www.dijidemi.com/Ogrenci2020/Video?___layout';
    const body = `tur=2&sinavId=0&sinavTuru=2&testId=${testId}&soruId=${soruId}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            body,
        });

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
