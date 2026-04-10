import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { RateLimits } from '@/lib/rate-limit';

const NUMERIC_ID_PATTERN = /^\d+$/;

function parseNumericId(value: unknown, field: string, maxLength: number): string | NextResponse {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return NextResponse.json({ error: `${field} gerekli` }, { status: 400 });
    }
    const normalized = String(value).trim();
    if (!normalized || normalized.length > maxLength || !NUMERIC_ID_PATTERN.test(normalized)) {
        return NextResponse.json({ error: `${field} geçersiz` }, { status: 400 });
    }
    return normalized;
}

export async function POST(request: NextRequest) {
    try {
        // Auth check
        const auth = await requireAuth(request);
        if (auth instanceof NextResponse) return auth;

        // Rate limit
        const ip = getClientIp(request);
        if (!(await RateLimits.GENERAL(ip, auth.userId))) {
            return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
        }

        let body: { bookId?: string; testId?: string; questionNumber?: string };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Geçersiz JSON gövdesi' }, { status: 400 });
        }
        const bookId = parseNumericId(body.bookId, 'bookId', 64);
        if (bookId instanceof NextResponse) return bookId;
        const testId = parseNumericId(body.testId, 'testId', 64);
        if (testId instanceof NextResponse) return testId;
        const questionNumber = parseNumericId(body.questionNumber, 'questionNumber', 16);
        if (questionNumber instanceof NextResponse) return questionNumber;

        const targetUrl = new URL('https://www.dijidemi.com/Ogrenci/KitapTestDetay');
        targetUrl.search = new URLSearchParams({
            kitapId: bookId,
            ___layout: '',
        }).toString();

        const pageResponse = await requestDijidemiUpstream({
            request,
            userId: auth.userId,
            url: targetUrl.toString(),
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'text/html, */*; q=0.01',
            },
            body: new URLSearchParams({ id: testId }).toString(),
            referrer: 'https://www.dijidemi.com/Ogrenci',
        });
        if (pageResponse instanceof NextResponse) return pageResponse;

        if (!pageResponse.ok) {
            return NextResponse.json({ error: 'Sayfa yüklenemedi' }, { status: 502 });
        }

        const html = await pageResponse.text();
        const $ = cheerio.load(html);
        const questionEl = $(`.rowSoru[data-soruno="${questionNumber}"]`);
        let imageUrl = questionEl.attr('data-soruimg');

        if (imageUrl && imageUrl.startsWith('/')) {
            imageUrl = `https://yayin.etapyayinlari.com${imageUrl}`;
        }

        return NextResponse.json({ success: true, imageUrl });

    } catch (error) {
        return NextResponse.json({ error: 'Hata oluştu' }, { status: 500 });
    }
}
