import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import cookieManager from '@/lib/cookie/cookieManager';

// List of available API keys for rotation
const API_KEYS = [
    process.env.GEMINI_FIRST_API_KEY,
    process.env.GEMINI_SECOND_API_KEY,
    process.env.GEMINI_THIRD_API_KEY,
    process.env.GEMINI_FOURTH_API_KEY,
    process.env.GEMINI_API_KEY // Fallback to original if exists
].filter(Boolean) as string[];

// Helper to get model instance for a specific key
const getModel = (apiKey: string) => {
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
};

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // --- CHAT MODE (Follow-up questions) ---
        if (body.mode === 'chat') {
            const { history } = body;

            // Ensure history starts with a USER role (Gemini requirement)
            let safeHistory = history;
            if (history.length > 0 && history[0].role === 'model') {
                safeHistory = [
                    { role: 'user', parts: [{ text: 'Lütfen bu soruyu çöz.' }] },
                    ...history
                ];
            }

            // Retry logic for Chat
            let lastError;
            for (const apiKey of API_KEYS) {
                try {
                    const model = getModel(apiKey);
                    const chat = model.startChat({ history: safeHistory });

                    const lastMsg = history[history.length - 1];
                    const msgText = lastMsg.parts[0].text + "\n(Matematiksel ifadeleri lütfen '$' içinde LaTeX formatında yaz.)";

                    const result = await chat.sendMessage(msgText);
                    const response = result.response;
                    return NextResponse.json({ reply: response.text() });
                } catch (error: any) {
                    console.error(`[API] Key failed (Chat): ${apiKey.substring(0, 10)}... Error: ${error.message}`);
                    lastError = error;
                    if (error.message?.includes('429') || error.status === 429) {
                        continue; // Try next key
                    }
                    throw error; // If not 429, throw immediately
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

        // Use CookieManager to get valid server-side auth headers
        const authHeaders = await cookieManager.getHeaders();
        const fetchCookies = authHeaders['Cookie'] || '';

        // 1. Fetch Test Page from Dijidemi to find Image URL
        const targetUrl = `https://www.dijidemi.com/Ogrenci/KitapTestDetay?kitapId=${bookId}&___layout`;

        const payload = `id=${testId}`;
        console.log(`[API] REQUEST DETAILS:\nURL: ${targetUrl}\nPAYLOAD: ${payload}\nCOOKIES (Length): ${fetchCookies.length}`);

        const pageResponse = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Cookie': fetchCookies,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'text/html, */*; q=0.01',
                'Origin': 'https://www.dijidemi.com',
                'Referer': 'https://www.dijidemi.com/Ogrenci',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty',
                'Accept-Language': 'en-US,en;q=0.9',
                'Priority': 'u=1, i'
            },
            body: `id=${testId}`
        });

        if (!pageResponse.ok) {
            console.error(`[API] ❌ Page fetch failed: ${pageResponse.status} ${pageResponse.statusText}`);
            return NextResponse.json({ error: 'Dijidemi sayfasına erişilemedi.' }, { status: 502 });
        }

        const html = await pageResponse.text();
        console.log(`[API] 2. Page fetched (${html.length} chars). Parsing HTML...`);

        const $ = cheerio.load(html);

        // Find the specific question by data-soruno
        const questionEl = $(`.rowSoru[data-soruno="${questionNumber}"]`);
        let imageUrl = questionEl.attr('data-soruimg');

        if (!imageUrl) {
            const pageTitle = $('title').text();
            console.log(`[API] Page Title: ${pageTitle}`);
            console.log(`[API] ❌ Image URL NOT found for Q${questionNumber}. Cheerio search failed.`);

            return NextResponse.json({
                error: `Soru resmi bulunamadı. (Sayfa Başlığı: ${pageTitle}) HTML yapısı değişmiş veya oturum düşmüş olabilir.`
            }, { status: 404 });
        }

        // Ensure full URL
        if (imageUrl.startsWith('/')) {
            imageUrl = `https://yayin.etapyayinlari.com${imageUrl}`;
        }

        console.log(`[API] 3. Found Image URL: ${imageUrl}. Fetching image...`);

        // 2. Fetch the Image Data
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            console.error(`[API] ❌ Image fetch failed: ${imageResponse.status}`);
            return NextResponse.json({ error: 'Resim dosyası indirilemedi.' }, { status: 502 });
        }
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBase64 = Buffer.from(imageBuffer).toString('base64');
        console.log(`[API] 4. Image fetched (${imageBuffer.byteLength} bytes). Sending to Gemini...`);


        // 3. Send to Gemini with Rotational Logic
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
                success = true;
                console.log(`[API] Success with Key #${index + 1}`);
                break; // Exit loop on success

            } catch (error: any) {
                console.error(`[API] Key #${index + 1} failed: ${error.message}`);
                lastError = error;

                // Restart logic if 429
                if (error.message?.includes('429') || error.status === 429) {
                    continue;
                }
                // If other error, maybe still try others? For safety let's continue for any error in production
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
        console.error('[API] ❌ AI Solve Error:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
    }
}
