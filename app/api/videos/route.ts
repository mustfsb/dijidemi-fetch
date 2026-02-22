import { NextRequest, NextResponse } from 'next/server';
import cookieManager from '@/lib/cookie/cookieManager';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

interface VideoResult {
    q: number;
    url: string | null;
}

/**
 * Batch video endpoint: fetches all video URLs for a test in a single server-side call.
 * Replaces 40 individual /api/video calls with one request.
 * 
 * GET /api/videos?testId=123&count=40
 */
export async function GET(request: NextRequest) {
    // Auth check
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Rate limit (use GENERAL — this replaces 40 calls with 1)
    const ip = getClientIp(request);
    if (!RateLimits.GENERAL(ip, auth.userId)) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const testId = searchParams.get('testId');
    const count = parseInt(searchParams.get('count') || '40', 10);

    if (!testId) {
        return NextResponse.json({ error: 'Missing testId' }, { status: 400 });
    }

    if (count < 1 || count > 100) {
        return NextResponse.json({ error: 'Invalid count (1-100)' }, { status: 400 });
    }

    try {
        // Single headers fetch — cached for 30s by cookieManager
        const headers = await cookieManager.getHeaders();
        const url = `https://www.dijidemi.com/Ogrenci2020/Video?___layout`;

        // Fetch all videos in parallel with concurrency limit
        const CONCURRENCY = 10;
        const results: VideoResult[] = [];

        for (let batch = 0; batch < count; batch += CONCURRENCY) {
            const batchEnd = Math.min(batch + CONCURRENCY, count);
            const batchPromises: Promise<VideoResult>[] = [];

            for (let i = batch; i < batchEnd; i++) {
                const soruId = i + 1;
                batchPromises.push(
                    fetchVideoUrl(url, headers, testId, soruId)
                );
            }

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        // Filter out nulls and return only successful results
        const videos = results
            .filter(r => r.url !== null)
            .sort((a, b) => a.q - b.q);

        return NextResponse.json({
            success: true,
            testId,
            videos,
            total: count,
            found: videos.length
        });

    } catch (error) {
        console.error('Batch Video Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

async function fetchVideoUrl(
    url: string,
    headers: Record<string, string>,
    testId: string,
    soruId: number
): Promise<VideoResult> {
    try {
        const body = `tur=2&sinavId=0&sinavTuru=2&testId=${testId}&soruId=${soruId}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body
        });

        if (!response.ok) {
            return { q: soruId, url: null };
        }

        const html = await response.text();

        // Extract video URL — same logic as /api/video
        let videoUrl: string | null = null;

        // Pattern 1: <video ... src="...">
        const videoSrcMatch = html.match(/<video[^>]*src="([^"]+)"/i);
        if (videoSrcMatch) videoUrl = videoSrcMatch[1];

        // Pattern 2: <source src="..."> inside video
        if (!videoUrl) {
            const sourceSrcMatch = html.match(/<source[^>]*src="([^"]+)"/i);
            if (sourceSrcMatch) videoUrl = sourceSrcMatch[1];
        }

        // Pattern 3: direct .mp4 links
        if (!videoUrl) {
            const mp4Match = html.match(/"([^"]+\.mp4)"/);
            if (mp4Match) videoUrl = mp4Match[1];
        }

        return { q: soruId, url: videoUrl };
    } catch {
        return { q: soruId, url: null };
    }
}
