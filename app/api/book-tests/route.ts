import { NextRequest, NextResponse } from 'next/server';
import type { BookTestsRequest, Test } from '@/types';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { RateLimits } from '@/lib/rate-limit';

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

        const url = new URL('https://www.dijidemi.com/Ogrenci/KitapTestlerTable');
        url.search = new URLSearchParams({
            Id: id,
            ___layout: '',
        }).toString();

        const response = await requestDijidemiUpstream({
            request,
            userId: auth.userId,
            url: url.toString(),
            method: 'POST',
            body: '',
        });
        if (response instanceof NextResponse) return response;

        if (!response.ok) {
            return NextResponse.json({ error: `Upstream error: ${response.status}` }, { status: response.status });
        }

        const html = await response.text();

        // Improved parsing logic to capture ALL tests
        // We look for the pattern: <h3>Title</h3> ... data-rowid="ID"
        // The previous split method might have been too aggressive or missed nested structures.
        // Using a global regex with matchAll is safer.

        const tests: Test[] = [];
        // Regex explanation:
        // <h3>(.*?)<\/h3>  -> Captures the title inside h3
        // [\s\S]*?         -> Matches any character (including newlines) non-greedily until...
        // data-rowid="(\d+)" -> Captures the numeric ID
        const regex = /<h3>(.*?)<\/h3>[\s\S]*?data-rowid="(\d+)"/g;

        const matches = [...html.matchAll(regex)];

        for (const match of matches) {
            let title = match[1].trim();
            const id = match[2];

            // Decode HTML entities
            title = title.replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)));

            tests.push({
                name: title,
                id: id
            });
        }

        return NextResponse.json({ success: true, tests });

    } catch (error) {
        console.error('Error fetching tests:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
