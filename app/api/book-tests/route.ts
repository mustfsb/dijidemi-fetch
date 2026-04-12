import { NextRequest, NextResponse } from 'next/server';
import type { BookTestsRequest, Test } from '@/types';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import { supabase } from '@/lib/db/supabase';
import {
    parseBookTestsFromHtml,
    parseBookTestsPayload,
    readBufferedUpstreamPayload,
    requestUpstreamApi,
} from '@/lib/upstreamApi';

export const maxDuration = 25;

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

async function getCachedTests(bookId: string): Promise<Test[] | null> {
    try {
        const { data, error } = await supabase
            .from('book_tests_cache')
            .select('tests, updated_at')
            .eq('book_id', bookId)
            .single();

        if (error || !data) return null;

        const age = Date.now() - new Date(data.updated_at).getTime();
        if (age > CACHE_TTL_MS) return null;

        return data.tests as Test[];
    } catch {
        return null;
    }
}

async function setCachedTests(bookId: string, tests: Test[]): Promise<void> {
    try {
        await supabase
            .from('book_tests_cache')
            .upsert({ book_id: bookId, tests, updated_at: new Date().toISOString() });
    } catch {
        // cache write failure is non-fatal
    }
}

async function getStaleCachedTests(bookId: string): Promise<Test[] | null> {
    try {
        const { data } = await supabase
            .from('book_tests_cache')
            .select('tests')
            .eq('book_id', bookId)
            .single();
        return data ? (data.tests as Test[]) : null;
    } catch {
        return null;
    }
}

interface BookTestsApiResponse {
    success?: boolean;
    tests?: Test[];
    error?: string;
}

const NUMERIC_ID_PATTERN = /^\d+$/;

function parseNumericId(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    if (!normalized || normalized.length > 64 || !NUMERIC_ID_PATTERN.test(normalized)) {
        return null;
    }
    return normalized;
}

export async function POST(request: NextRequest): Promise<NextResponse<BookTestsApiResponse>> {
    try {
        // Auth check
        const auth = await requireAuth(request);
        if (auth instanceof NextResponse) return auth;

        // Rate limit
        const ip = getClientIp(request);
        if (!(await RateLimits.GENERAL(ip, auth.userId))) {
            return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
        }

        let body: BookTestsRequest;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const id = parseNumericId(body.id);

        if (!id) {
            return NextResponse.json({ error: 'Book ID is invalid' }, { status: 400 });
        }

        // 1. Try fresh cache first
        const cached = await getCachedTests(id);
        if (cached) {
            return NextResponse.json({ success: true, tests: cached, cached: true });
        }

        let tests: Test[] | null = null;
        let upstreamError: string | null = null;

        try {
            const proxyResponse = await requestUpstreamApi({
                path: '/api/proxy',
                method: 'POST',
                json: {
                    url: `https://www.dijidemi.com/Ogrenci/KitapTestlerTable?Id=${encodeURIComponent(id)}&___layout=`,
                    method: 'POST',
                    body: '',
                },
            });

            if (!(proxyResponse instanceof NextResponse) && proxyResponse.ok) {
                const proxyPayload = readBufferedUpstreamPayload(proxyResponse);
                const proxyRecord = (
                    proxyPayload
                    && typeof proxyPayload === 'object'
                    && !Array.isArray(proxyPayload)
                ) ? proxyPayload as Record<string, unknown> : null;
                const html = typeof proxyRecord?.body === 'string'
                    ? proxyRecord.body
                    : null;

                if (html) {
                    const parsedFromHtml = parseBookTestsFromHtml(html);
                    if (parsedFromHtml.length > 0) {
                        tests = parsedFromHtml;
                    } else {
                        upstreamError = 'Proxy returned HTML but no test rows were parsed';
                        console.error(`[book-tests] proxy HTML parse failed for book ${id}`);
                    }
                } else {
                    upstreamError = 'Proxy response did not include an HTML body';
                    console.error(`[book-tests] proxy response missing HTML body for book ${id}`);
                }
            } else if (proxyResponse instanceof NextResponse) {
                const payload = await proxyResponse.json().catch(() => ({}));
                upstreamError = typeof payload.error === 'string'
                    ? payload.error
                    : 'Proxy transport failed';
                console.error(`[book-tests] proxy transport error for book ${id}: ${upstreamError}`);
            } else {
                upstreamError = `Proxy returned HTTP ${proxyResponse.status}`;
                console.error(`[book-tests] proxy HTTP error for book ${id}: ${proxyResponse.status}`);
            }

            if (tests === null) {
                for (const method of ['GET', 'POST'] as const) {
                    const response = await requestUpstreamApi({
                        path: '/api/get-book',
                        method,
                        query: { Id: id },
                    });

                    if (response instanceof NextResponse) {
                        const payload = await response.json().catch(() => ({}));
                        upstreamError = typeof payload.error === 'string'
                            ? payload.error
                            : `Upstream request failed (${method})`;
                        console.error(`[book-tests] upstream transport error via ${method} for book ${id}: ${upstreamError}`);
                        continue;
                    }

                    if (!response.ok) {
                        upstreamError = `Upstream returned HTTP ${response.status} (${method})`;
                        console.error(`[book-tests] upstream HTTP error via ${method} for book ${id}: ${response.status}`);
                        continue;
                    }

                    const parsed = parseBookTestsPayload(readBufferedUpstreamPayload(response));
                    if (parsed.length > 0) {
                        tests = parsed;
                        break;
                    }

                    upstreamError = `Empty or unparseable payload from upstream (${method})`;
                    console.error(`[book-tests] empty/unparseable payload via ${method} for book ${id}`);
                }
            }
        } catch (error) {
            upstreamError = error instanceof Error ? error.message : 'Unknown upstream error';
            console.error(`[book-tests] unexpected upstream failure for book ${id}:`, error);
        }

        if (tests !== null) {
            await setCachedTests(id, tests);
            return NextResponse.json({ success: true, tests });
        }

        // 3. Upstream failed — return stale cache if available
        const stale = await getStaleCachedTests(id);
        if (stale) {
            return NextResponse.json({ success: true, tests: stale, cached: true, stale: true });
        }

        return NextResponse.json(
            {
                error: upstreamError || 'Testler yüklenemedi. Yeni API yanıt vermiyor veya beklenen formatta veri dönmüyor.',
            },
            { status: upstreamError?.includes('timeout') ? 504 : 503 }
        );

    } catch (error) {
        console.error('Error fetching tests:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

}
