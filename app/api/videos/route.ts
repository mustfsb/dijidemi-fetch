import { NextRequest, NextResponse } from 'next/server';
import {
    isLocalBrowserMode,
    requireAuth,
    getClientIp,
    createMissingDijidemiSessionResponse,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { directFetchDijidemi } from '@/lib/dijidemi/directFetch';
import cookieManager from '@/lib/cookie/cookieManager';
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

function extractVideoUrl(html: string): string | null {
    const videoSrcMatch = html.match(/<video[^>]*src="([^"]+)"/i);
    if (videoSrcMatch) return videoSrcMatch[1];

    const sourceSrcMatch = html.match(/<source[^>]*src="([^"]+)"/i);
    if (sourceSrcMatch) return sourceSrcMatch[1];

    const mp4Match = html.match(/"([^"]+\.mp4)"/);
    if (mp4Match) return mp4Match[1];

    return null;
}

function isChallengeHtml(body: string): boolean {
    const normalized = body.toLowerCase();
    return (
        normalized.includes('just a moment')
        || normalized.includes('bir dakika lütfen')
        || normalized.includes('enable javascript and cookies to continue')
        || normalized.includes('güvenlik doğrulaması gerçekleştirme')
    );
}

/**
 * Streaming video batch endpoint — returns Server-Sent Events.
 *
 * GET /api/videos?testId=123&count=40
 *
 * Each video URL is emitted as it is resolved:
 *   data: {"q":1,"url":"https://..."}\n\n
 *
 * Final event:
 *   data: {"done":true,"found":N,"total":M}\n\n
 */
export async function GET(request: NextRequest) {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const ip = getClientIp(request);
    if (!(await RateLimits.GENERAL(ip, auth.userId))) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const testId = parseNumericParam(searchParams.get('testId'), 'testId');
    if (testId instanceof NextResponse) return testId;

    const rawCount = parseInt(searchParams.get('count') || '40', 10);
    const count = Number.isFinite(rawCount) && rawCount >= 1 && rawCount <= 100 ? rawCount : 40;

    const videoUrl = `https://www.dijidemi.com/Ogrenci2020/Video?___layout`;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            let foundCount = 0;
            let blocked = false;

            const emit = (data: object) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            try {
                if (isLocalBrowserMode()) {
                    // Local browser mode: sequential requests through localDijidemiBrowserManager
                    for (let soruId = 1; soruId <= count; soruId++) {
                        const body = new URLSearchParams({
                            tur: '2', sinavId: '0', sinavTuru: '2',
                            testId, soruId: String(soruId),
                        }).toString();

                        const response = await requestDijidemiUpstream({
                            request,
                            userId: auth.userId,
                            url: videoUrl,
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                            body,
                            referrer: 'https://www.dijidemi.com/Ogrenci2020',
                        });

                        if (response instanceof NextResponse) {
                            blocked = true;
                            break;
                        }

                        if (response.ok) {
                            const html = await response.text();
                            const url = extractVideoUrl(html);
                            if (url) {
                                foundCount++;
                                emit({ q: soruId, url });
                            }
                        }
                    }
                } else {
                    // Production mode: direct HTTP fetches in parallel (mobile UA + stored cookies)
                    const cookies = await cookieManager.getCookies();
                    if (!cookies.some(c => c.name === 'cf_clearance' && c.value)) {
                        emit({ error: 'missing_session' });
                        return;
                    }

                    await Promise.all(
                        Array.from({ length: count }, async (_, i) => {
                            const soruId = i + 1;
                            try {
                                const result = await directFetchDijidemi(videoUrl, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                                    body: new URLSearchParams({
                                        tur: '2', sinavId: '0', sinavTuru: '2',
                                        testId, soruId: String(soruId),
                                    }).toString(),
                                    cookies,
                                    referrer: 'https://www.dijidemi.com/Ogrenci2020',
                                });
                                if (result.isCloudflareChallenge) { blocked = true; return; }
                                const url = extractVideoUrl(result.body);
                                if (url) { foundCount++; emit({ q: soruId, url }); }
                            } catch { /* skip failed question */ }
                        })
                    );
                }

                if (blocked && foundCount === 0) {
                    emit({ error: 'cloudflare_blocked' });
                } else {
                    emit({ done: true, found: foundCount, total: count });
                }
            } catch (err) {
                console.error('Videos SSE Error:', err instanceof Error ? err.message.substring(0, 100) : 'Unknown');
                emit({ error: 'internal_error' });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
