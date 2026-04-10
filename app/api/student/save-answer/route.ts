import { NextRequest, NextResponse } from 'next/server';
import type { SaveAnswerRequest, UserAnswers } from '@/types';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { RateLimits } from '@/lib/rate-limit';

interface SaveAnswerResponse {
    success?: boolean;
    raw?: string;
    error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<SaveAnswerResponse>> {
    try {
        // Auth check
        const auth = await requireAuth(request);
        if (auth instanceof NextResponse) return auth;

        // Rate limit
        const ip = getClientIp(request);
        if (!(await RateLimits.GENERAL(ip, auth.userId))) {
            return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
        }

        let body: SaveAnswerRequest;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Geçersiz JSON gövdesi' }, { status: 400 });
        }
        const { testId, answers, totalQuestions, dersId = 0, odevId = 0, turId = 2 } = body;
        if (!testId || typeof testId !== 'string' || testId.length > 64) {
            return NextResponse.json({ error: 'Geçersiz testId' }, { status: 400 });
        }
        if (!answers || typeof answers !== 'object') {
            return NextResponse.json({ error: 'Geçersiz answers alanı' }, { status: 400 });
        }
        const limit = totalQuestions || 40;
        if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
            return NextResponse.json({ error: 'Geçersiz totalQuestions' }, { status: 400 });
        }

        // 1. Construct Answer String
        let answersString = "";
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

        const response = await requestDijidemiUpstream({
            request,
            userId: auth.userId,
            url,
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json; charset=UTF-8',
            },
            additionalCookies: {
                kullaniciId: '0',
                soruCevap: soruCevapJson,
            },
            referrer: 'https://www.dijidemi.com/Ogrenci',
        });
        if (response instanceof NextResponse) return response;

        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to save answers' }, { status: response.status });
        }

        const text = await response.text();
        return NextResponse.json({ success: true, raw: text });

    } catch (error) {
        console.error('Save Answer Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
        return NextResponse.json({ error: 'Cevap kaydedilirken hata oluştu.' }, { status: 500 });
    }
}
