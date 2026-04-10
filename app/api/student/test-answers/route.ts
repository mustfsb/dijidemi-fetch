import { NextRequest, NextResponse } from 'next/server';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { RateLimits } from '@/lib/rate-limit';

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

interface DijidemiTestAnswersPayload {
    Success?: boolean;
    ogCevaplar?: string;
    tCevaplar?: string;
}

const NUMERIC_ID_PATTERN = /^\d+$/;

function parseNumericParam(value: string | null, field: string): string | NextResponse<TestAnswersResponse> {
    const normalized = value?.trim() || '';
    if (!normalized || !NUMERIC_ID_PATTERN.test(normalized)) {
        return NextResponse.json({ success: false, error: `${field} parametresi geçersiz` }, { status: 400 });
    }
    return normalized;
}

export async function GET(request: NextRequest): Promise<NextResponse<TestAnswersResponse>> {
    // Auth check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth as NextResponse<TestAnswersResponse>;

    // Rate limit
    const ip = getClientIp(request);
    if (!(await RateLimits.GENERAL(ip, auth.userId))) {
        return NextResponse.json({ success: false, error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const testId = parseNumericParam(searchParams.get('testId'), 'testId');
    if (testId instanceof NextResponse) return testId;
    const turID = parseNumericParam(searchParams.get('turID') || '2', 'turID');
    if (turID instanceof NextResponse) return turID;

    try {
        // Build URL with timestamp
        const timestamp = Date.now().toString();
        const url = new URL('https://www.dijidemi.com/Ogrenci2020/GetOgrenciTestCevaplar');
        url.search = new URLSearchParams({
            testId,
            turID,
            _: timestamp,
        }).toString();

        const response = await requestDijidemiUpstream({
            request,
            userId: auth.userId,
            url: url.toString(),
            method: 'GET',
            headers: {
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
            },
            additionalCookies: {
                kullaniciId: '0',
                soruCevap: JSON.stringify({ 0: {} }),
            },
            referrer: 'https://www.dijidemi.com/Ogrenci2020',
        });
        if (response instanceof NextResponse) return response as NextResponse<TestAnswersResponse>;

        if (!response.ok) {
            return NextResponse.json({
                success: false,
                error: `API yanıt hatası: ${response.status}`
            }, { status: response.status });
        }

        const data = await response.json<DijidemiTestAnswersPayload>();

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
