import { NextRequest, NextResponse } from 'next/server';
import {
    requireAuth,
    getClientIp,
    createMissingDijidemiSessionResponse,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
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
                // Fetch in parallel using Python proxy
                const requests = Array.from({ length: count }, (_, i) => {
                    const soruId = i + 1;
                    return {
                        url: videoUrl,
                        method: 'POST' as const,
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                        body: new URLSearchParams({
                            tur: '2', sinavId: '0', sinavTuru: '2',
                            testId, soruId: String(soruId),
                        }).toString(),
                        referrer: 'https://www.dijidemi.com/Ogrenci2020',
                    };
                });

                await Promise.all(
                    requests.map(async (req, index) => {
                        try {
                            const response = await requestDijidemiUpstream({
                                request,
                                userId: auth.userId,
                                url: req.url,
                                method: req.method,
                                headers: req.headers,
                                body: req.body,
                                referrer: req.referrer,
                            });

                            if (response instanceof NextResponse) {
                                blocked = true;
                                return;
                            }

                            if (response.ok) {
                                const html = await response.text();
                                if (isChallengeHtml(html)) {
                                    blocked = true;
                                    return;
                                }
                                const url = extractVideoUrl(html);
                                if (url) {
                                    foundCount++;
                                    emit({ q: index + 1, url });
                                }
                            }
                        } catch (err) {
                            // ignore individual errors, we don't want one failure to stop all
                        }
                    })
                );

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
