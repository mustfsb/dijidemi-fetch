import { NextRequest, NextResponse } from 'next/server';
import cookieManager from '@/lib/cookie/cookieManager';
import type { VideoResponse } from '@/types';

export async function GET(request: NextRequest): Promise<NextResponse<VideoResponse | { error: string; details?: string }>> {
    const { searchParams } = new URL(request.url);
    const testId = searchParams.get('testId');
    const soruId = searchParams.get('soruId');

    if (!testId || !soruId) {
        return NextResponse.json({ error: 'Missing testId or soruId' }, { status: 400 });
    }

    // Headers from user request
    const headers = await cookieManager.getHeaders();

    const url = `https://www.dijidemi.com/Ogrenci2020/Video?___layout`;

    // Body from user request: tur=2&sinavId=0&sinavTuru=2&testId=1120092&soruId=1
    const body = `tur=2&sinavId=0&sinavTuru=2&testId=${testId}&soruId=${soruId}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: body
        });

        if (!response.ok) {
            return NextResponse.json({ error: `Upstream error: ${response.status}` }, { status: response.status });
        }

        const html = await response.text();

        // Extract video URL - Robust Regex
        // Matches <video src="...">, <source src="...">, or known patterns
        let videoUrl: string | null = null;

        // Pattern 1: <video ... src="...">
        const videoSrcMatch = html.match(/<video[^>]*src="([^"]+)"/i);
        if (videoSrcMatch) videoUrl = videoSrcMatch[1];

        // Pattern 2: <source src="..."> inside video
        if (!videoUrl) {
            const sourceSrcMatch = html.match(/<source[^>]*src="([^"]+)"/i);
            if (sourceSrcMatch) videoUrl = sourceSrcMatch[1];
        }

        // Pattern 3: JSON embedded or other
        if (!videoUrl) {
            // Check for direct .mp4 links in quotes
            const mp4Match = html.match(/"([^"]+\.mp4)"/);
            if (mp4Match) videoUrl = mp4Match[1];
        }

        if (videoUrl) {
            return NextResponse.json({
                success: true,
                videoUrl: videoUrl,
                testId,
                soruId
            });
        } else {
            return NextResponse.json({
                success: false,
                message: 'Video not found',
                // htmlSnippet: html.substring(0, 500) // DEBUG: Remove in prod if spammy
            });
        }

    } catch (error) {
        console.error('Video Proxy Error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
