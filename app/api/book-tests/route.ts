import { NextRequest, NextResponse } from 'next/server';
import type { BookTestsRequest, Test } from '@/types';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { RateLimits } from '@/lib/rate-limit';
import { supabase } from '@/lib/db/supabase';

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

        // 2. Try live fetch from dijidemi.com
        const upstreamUrl = new URL('https://www.dijidemi.com/Ogrenci/KitapTestlerTable');
        upstreamUrl.search = new URLSearchParams({ Id: id, ___layout: '' }).toString();

        let tests: Test[] | null = null;

        try {
            const response = await requestDijidemiUpstream({
                request,
                userId: auth.userId,
                url: upstreamUrl.toString(),
                method: 'POST',
                body: '',
            });

            if (!(response instanceof NextResponse) && response.ok) {
                const html = await response.text();
                const regex = /<h3>(.*?)<\/h3>[\s\S]*?data-rowid="(\d+)"/g;
                tests = [...html.matchAll(regex)].map(match => ({
                    name: match[1].trim().replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10))),
                    id: match[2],
                }));
            }
        } catch {
            // upstream failed — fall through to stale cache
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
            { error: 'Testler yüklenemedi. Lütfen yerel makinede "npm run sync-books" çalıştırın.' },
            { status: 503 }
        );

    } catch (error) {
        console.error('Error fetching tests:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

}
