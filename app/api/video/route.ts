import { NextRequest, NextResponse } from 'next/server';
import type { VideoResponse } from '@/types';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
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

    const url = `https://www.dijidemi.com/Ogrenci2020/Video?___layout`;

    // Body from user request: tur=2&sinavId=0&sinavTuru=2&testId=1120092&soruId=1
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
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body,
            referrer: 'https://www.dijidemi.com/Ogrenci2020',
        });
        if (response instanceof NextResponse) return response;

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
        console.error('Video Proxy Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

}
