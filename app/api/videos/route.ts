import { NextRequest, NextResponse } from 'next/server';
import {
    getClientIp,
} from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import {
    extractVideoUrlFromPayload,
    readBufferedUpstreamPayload,
    requestUpstreamApi,
} from '@/lib/upstreamApi';

export const maxDuration = 25;

const NUMERIC_ID_PATTERN = /^\d+$/;

function parseNumericParam(value: string | null, field: string): string | NextResponse {
    const normalized = value?.trim() || '';
    if (!normalized || !NUMERIC_ID_PATTERN.test(normalized)) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
    }
    return normalized;
}

async function fetchVideoUrl(testId: string, soruId: number): Promise<string | null> {
    const response = await requestUpstreamApi({
        path: '/api/video',
        method: 'POST',
        json: {
            testId: Number(testId),
            soruId,
        },
    });

    if (response instanceof NextResponse || !response.ok) {
        console.warn(`[videos] upstream failed for testId=${testId} soruId=${soruId}: ${response instanceof NextResponse ? 'transport error' : response.status}`);
        return null;
    }

    const payload = readBufferedUpstreamPayload(response);
    const url = extractVideoUrlFromPayload(payload);
    if (!url) {
        console.log(`[videos] no url extracted for testId=${testId} soruId=${soruId}, payload:`, JSON.stringify(payload).substring(0, 200));
    }
    return url;
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
    const ip = getClientIp(request);
    if (!(await RateLimits.GENERAL(ip))) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const testId = parseNumericParam(searchParams.get('testId'), 'testId');
    if (testId instanceof NextResponse) return testId;

    const rawCount = parseInt(searchParams.get('count') || '40', 10);
    const count = Number.isFinite(rawCount) && rawCount >= 1 && rawCount <= 100 ? rawCount : 40;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            let foundCount = 0;

            const emit = (data: object) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            try {
                const concurrency = Math.min(8, count);
                let nextQuestion = 1;

                const worker = async (): Promise<void> => {
                    while (nextQuestion <= count) {
                        const soruId = nextQuestion;
                        nextQuestion += 1;

                        const url = await fetchVideoUrl(testId, soruId);
                        if (!url) continue;

                        foundCount += 1;
                        emit({ q: soruId, url });
                    }
                };

                await Promise.all(
                    Array.from({ length: concurrency }, () => worker())
                );

                emit({ done: true, found: foundCount, total: count });
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
