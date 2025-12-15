import { NextRequest, NextResponse } from 'next/server';
import cookieManager from '@/lib/cookie/cookieManager';
import type { SaveAnswerRequest, UserAnswers } from '@/types';

interface SaveAnswerResponse {
    success?: boolean;
    raw?: string;
    error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<SaveAnswerResponse>> {
    try {
        const body: SaveAnswerRequest = await request.json();
        const { testId, answers, totalQuestions, dersId = 0, odevId = 0, turId = 2 } = body;

        // AUTH: Get fresh bot cookies from Manager
        const authHeaders = await cookieManager.getHeaders();
        const baseCookie = authHeaders['Cookie'] || '';

        // 1. Construct Answer String
        let answersString = "";
        const limit = totalQuestions || 40;
        for (let i = 1; i <= limit; i++) {
            answersString += (answers[i] || " ");
        }

        // 2. Construct soruCevap Cookie JSON
        // Format: {"0":{"<testId>":{"0":{"1":"A"}}}}
        const cookieAnswers: { [key: string]: string } = {};
        Object.keys(answers).forEach(k => {
            cookieAnswers[k] = answers[parseInt(k, 10)];
        });

        const soruCevapObj = {
            "0": {
                [testId]: {
                    "0": cookieAnswers
                }
            }
        };
        const soruCevapJson = JSON.stringify(soruCevapObj);

        // 3. Construct URL Params
        const params = new URLSearchParams({
            dersId: String(dersId) || '969',
            odevId: String(odevId),
            testId,
            turId: String(turId),
            cevaplar: answersString,
            _: Date.now().toString()
        });

        const url = `https://www.dijidemi.com/Ogrenci2020/TestCevapKaydetV2?${params.toString()}`;

        // 4. Construct Cookie Header
        // Merge base Auth cookies with request-specific cookies
        const fullCookie = `${baseCookie}; kullaniciId=0; soruCevap=${soruCevapJson}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Cookie': fullCookie,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://www.dijidemi.com/Ogrenci',
                'Content-Type': 'application/json; charset=UTF-8'
            }
        });

        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to save answers' }, { status: response.status });
        }

        const text = await response.text();
        return NextResponse.json({ success: true, raw: text });

    } catch (error) {
        console.error('Save Answer Error:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
