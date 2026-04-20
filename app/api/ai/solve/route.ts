import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestUpstreamApi, readBufferedUpstreamPayload } from '@/lib/upstreamApi';
import { RateLimits } from '@/lib/rate-limit';

// List of available API keys for rotation
const API_KEYS = [
    process.env.GEMINI_FIRST_API_KEY,
    process.env.GEMINI_SECOND_API_KEY,
    process.env.GEMINI_THIRD_API_KEY,
    process.env.GEMINI_FOURTH_API_KEY,
    process.env.GEMINI_API_KEY
].filter(Boolean) as string[];

const getModel = (apiKey: string) => {
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview',
        generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.7,
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT' as any, threshold: 'BLOCK_MEDIUM_AND_ABOVE' as any },
            { category: 'HARM_CATEGORY_HATE_SPEECH' as any, threshold: 'BLOCK_MEDIUM_AND_ABOVE' as any },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' as any, threshold: 'BLOCK_MEDIUM_AND_ABOVE' as any },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT' as any, threshold: 'BLOCK_MEDIUM_AND_ABOVE' as any },
        ]
    });
};

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAuth(request);
        if (auth instanceof NextResponse) return auth;

        const ip = getClientIp(request);
        if (!(await RateLimits.AI(ip, auth.userId))) {
            return NextResponse.json({ error: 'Çok fazla AI isteği. Lütfen bekleyin.' }, { status: 429 });
        }

        let body: any;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Geçersiz JSON gövdesi' }, { status: 400 });
        }

        if (API_KEYS.length === 0) {
            return NextResponse.json({ error: 'API anahtarları yapılandırılmamış.' }, { status: 500 });
        }

        // --- CHAT MODE ---
        if (body.mode === 'chat') {
            const history = Array.isArray(body.history) ? body.history : [];
            if (history.length === 0) {
                return NextResponse.json({ error: 'Chat geçmişi boş olamaz.' }, { status: 400 });
            }

            let safeHistory = history;
            if (history.length > 0 && history[0].role === 'model') {
                safeHistory = [
                    { role: 'user', parts: [{ text: 'Lütfen bu soruyu çöz.' }] },
                    ...history
                ];
            }

            let lastError;
            for (const [index, apiKey] of API_KEYS.entries()) {
                try {
                    const model = getModel(apiKey);
                    const chat = model.startChat({ history: safeHistory });

                    const lastMsg = history[history.length - 1];
                    const lastText = lastMsg?.parts?.[0]?.text;
                    if (typeof lastText !== 'string' || !lastText.trim()) {
                        return NextResponse.json({ error: 'Geçersiz chat mesajı.' }, { status: 400 });
                    }
                    const msgText = `${lastText}\n(Matematiksel ifadeleri lütfen '$' içinde LaTeX formatında yaz.)`;

                    const result = await chat.sendMessage(msgText);
                    const response = result.response;
                    return NextResponse.json({ reply: response.text() });
                } catch (error: any) {
                    console.error(`[API] Key failed (Chat): Key #${index + 1} Error: ${error.message?.substring(0, 50)}`);
                    lastError = error;
                    if (error.message?.includes('429') || error.status === 429) {
                        continue;
                    }
                    throw error;
                }
            }
            throw lastError || new Error('All API keys failed');
        }

        // --- INITIAL SOLVE MODE ---
        const { bookId, testId, questionNumber } = body;

        console.log(`[API] Starting solve request for Q${questionNumber}, TestID: ${testId}`);

        if (!bookId || !testId || !questionNumber) {
            return NextResponse.json({ error: 'Eksik parametreler' }, { status: 400 });
        }
        if (
            String(bookId).length > 64
            || String(testId).length > 64
            || String(questionNumber).length > 16
        ) {
            return NextResponse.json({ error: 'Parametreler çok uzun' }, { status: 400 });
        }

        const targetUrl = `https://www.dijidemi.com/Ogrenci/KitapTestDetay?kitapId=${bookId}&___layout`;

        if (process.env.NODE_ENV === 'development') {
            console.log(`[API] Fetching test page for TestID: ${testId}, BookID: ${bookId}`);
        }

        const proxyResponse = await requestUpstreamApi({
            path: '/api/proxy',
            method: 'POST',
            json: {
                url: targetUrl,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'text/html, */*; q=0.01',
                },
                body: `id=${testId}`,
            },
        });

        if (proxyResponse instanceof NextResponse) return proxyResponse;

        if (!proxyResponse.ok) {
            console.error(`[API] Proxy fetch failed: ${proxyResponse.status}`);
            return NextResponse.json({ error: 'Dijidemi sayfasına erişilemedi.' }, { status: 502 });
        }

        const proxyPayload = readBufferedUpstreamPayload(proxyResponse) as {
            status: number;
            body: string;
            is_base64: boolean;
        } | null;

        if (!proxyPayload || typeof proxyPayload !== 'object' || proxyPayload.status !== 200 || proxyPayload.is_base64) {
            return NextResponse.json({ error: 'Dijidemi sayfasına erişilemedi.' }, { status: 502 });
        }

        const html = proxyPayload.body;
        const $ = cheerio.load(html);

        const questionEl = $(`.rowSoru[data-soruno="${questionNumber}"]`);
        let imageUrl = questionEl.attr('data-soruimg');

        if (!imageUrl) {
            console.error(`[API] Image URL not found for Q${questionNumber}`);
            return NextResponse.json({
                error: 'Soru resmi bulunamadı. HTML yapısı değişmiş veya oturum düşmüş olabilir.'
            }, { status: 404 });
        }

        if (imageUrl.startsWith('/')) {
            imageUrl = `https://yayin.etapyayinlari.com${imageUrl}`;
        }

        console.log(`[API] Found image for Q${questionNumber}. Fetching...`);

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            console.error(`[API] Image fetch failed: ${imageResponse.status}`);
            return NextResponse.json({ error: 'Resim dosyası indirilemedi.' }, { status: 502 });
        }
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBase64 = Buffer.from(imageBuffer).toString('base64');

        const prompt = `Bu resimdeki soruyu çöz.
        1. Önce sorunun metnini veya verilerini analiz et.
        2. Adım adım çözümü anlat.
        3. Cevabı net bir şekilde belirt.
        4. Samimi, eğitici bir öğretmen dili kullan.
        5. Matematik sorularında, formülleri ve ifadeleri MUTLAKA '$' (dolar) işareti içine alarak LaTeX formatında yaz.
        - ÖNEMLİ: '$' işaretini 'escape' etme (ters slash kullanma).
        - Örnek: $\\frac{1}{2}$, $x^2$, $\\sqrt{x}$
        - Paragraf blokları yapma, satır içi matematik kullan.`;

        let lastError;
        let success = false;
        let solutionText = '';

        for (const [index, apiKey] of API_KEYS.entries()) {
            try {
                console.log(`[API] Trying Key #${index + 1}...`);
                const model = getModel(apiKey);

                const result = await model.generateContent([
                    prompt,
                    {
                        inlineData: {
                            data: imageBase64,
                            mimeType: "image/png"
                        }
                    }
                ]);

                const response = result.response;
                solutionText = response.text();

                if (!solutionText || solutionText.trim().length === 0) {
                    console.warn(`[Solve API] Empty response from Key #${index + 1}.`);
                    continue;
                }

                success = true;
                console.log(`[API] Success with Key #${index + 1}`);
                break;

            } catch (error: any) {
                console.error(`[API] Key #${index + 1} failed: ${error.message?.substring(0, 50)}`);
                lastError = error;
                continue;
            }
        }

        if (!success) {
            throw lastError || new Error('All API keys exhausted.');
        }

        return NextResponse.json({
            success: true,
            imageUrl: imageUrl,
            solution: solutionText
        });

    } catch (error) {
        console.error('[API] AI Solve Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
        return NextResponse.json({ error: 'AI çözüm sırasında bir hata oluştu.' }, { status: 500 });
    }
}
