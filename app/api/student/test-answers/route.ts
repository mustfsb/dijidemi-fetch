import { NextRequest, NextResponse } from 'next/server';
import cookieManager from '@/lib/cookie/cookieManager';

interface TestAnswersResponse {
    success: boolean;
    ogCevaplar?: string;
    tCevaplar?: string;
    dogru?: number;
    yanlis?: number;
    bos?: number;
    net?: number;
    hasAnswers?: boolean;
    error?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse<TestAnswersResponse>> {
    const { searchParams } = new URL(request.url);
    const testId = searchParams.get('testId');
    const turID = searchParams.get('turID') || '2';

    if (!testId) {
        return NextResponse.json({
            success: false,
            error: 'testId parametresi gerekli'
        }, { status: 400 });
    }

    try {
        // Get auth headers
        const authHeaders = await cookieManager.getHeaders();
        const baseCookie = authHeaders['Cookie'] || '';
        const fullCookie = `${baseCookie}; kullaniciId = 0; soruCevap = { "0": {} }`;

        // Build URL with timestamp
        const timestamp = Date.now();
        const url = `https://www.dijidemi.com/Ogrenci2020/GetOgrenciTestCevaplar?testId=${testId}&turID=${turID}&_=${timestamp}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Cookie': fullCookie,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://www.dijidemi.com/Ogrenci2020',
            },
        });

        if (!response.ok) {
            return NextResponse.json({
                success: false,
                error: `API yanıt hatası: ${response.status}`
            }, { status: response.status });
        }

        const data = await response.json();

        if (!data.Success) {
            return NextResponse.json({
                success: false,
                error: 'API başarısız yanıt döndü'
            });
        }

        const ogCevaplar: string = data.ogCevaplar || '';
        const tCevaplar: string = data.tCevaplar || '';

        // Check if student has any answers (not all "O")
        const allEmpty = ogCevaplar.split('').every(c => c === 'O');

        if (allEmpty) {
            return NextResponse.json({
                success: true,
                ogCevaplar,
                tCevaplar,
                hasAnswers: false,
                dogru: 0,
                yanlis: 0,
                bos: ogCevaplar.length,
                net: 0
            });
        }

        // Calculate scores
        let dogru = 0;
        let yanlis = 0;
        let bos = 0;

        for (let i = 0; i < ogCevaplar.length && i < tCevaplar.length; i++) {
            const studentAnswer = ogCevaplar[i];
            const correctAnswer = tCevaplar[i];

            if (studentAnswer === 'O') {
                bos++;
            } else if (studentAnswer === correctAnswer) {
                dogru++;
            } else {
                yanlis++;
            }
        }

        // Calculate net (Doğru - Yanlış/4)
        const net = dogru - (yanlis / 4);

        return NextResponse.json({
            success: true,
            ogCevaplar,
            tCevaplar,
            hasAnswers: true,
            dogru,
            yanlis,
            bos,
            net: Math.round(net * 100) / 100 // Round to 2 decimal places
        });

    } catch (error) {
        console.error('Test Answers API Error:', error);
        return NextResponse.json({
            success: false,
            error: 'Sunucu hatası oluştu'
        }, { status: 500 });
    }
}
