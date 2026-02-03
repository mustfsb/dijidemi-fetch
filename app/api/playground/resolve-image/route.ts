import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import cookieManager from '@/lib/cookie/cookieManager';

export async function POST(request: NextRequest) {
    try {
        const { bookId, testId, questionNumber } = await request.json();

        if (!bookId || !testId || !questionNumber) {
            return NextResponse.json({ error: 'Eksik parametreler' }, { status: 400 });
        }

        const authHeaders = await cookieManager.getHeaders();
        const fetchCookies = authHeaders['Cookie'] || '';

        const targetUrl = `https://www.dijidemi.com/Ogrenci/KitapTestDetay?kitapId=${bookId}&___layout`;

        const pageResponse = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Cookie': fetchCookies,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'text/html, */*; q=0.01',
            },
            body: `id=${testId}`
        });

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
