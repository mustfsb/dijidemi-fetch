import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import { isIP } from 'node:net';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { RateLimits } from '@/lib/rate-limit';

// List of available API keys for rotation
const API_KEYS = [
    process.env.GEMINI_FIRST_API_KEY,
    process.env.GEMINI_SECOND_API_KEY,
    process.env.GEMINI_THIRD_API_KEY,
    process.env.GEMINI_FOURTH_API_KEY,
    process.env.GEMINI_API_KEY
].filter(Boolean) as string[];

const ALLOWED_IMAGE_HOSTS = ['yayin.etapyayinlari.com'] as const;

const getModel = (apiKey: string) => {
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
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

function sanitizeAllowedImageUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'https:') return null;
        if (!ALLOWED_IMAGE_HOSTS.includes(url.hostname.toLowerCase() as (typeof ALLOWED_IMAGE_HOSTS)[number])) return null;
        if (isIP(url.hostname) !== 0) return null;
        if (url.username || url.password) return null;
        return url.toString();
    } catch {
        return null;
    }
}

async function fetchImagePart(url: string) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Image fetch failed");
        const buffer = await response.arrayBuffer();
        return {
            inlineData: {
                data: Buffer.from(buffer).toString("base64"),
                mimeType: "image/png",
            },
        };
    } catch (e) {
        console.error("Image fetch error:", url, e);
        return null;
    }
}

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Rate limit (AI is costly)
    const ip = getClientIp(request);
    if (!(await RateLimits.AI(ip, auth.userId))) {
        return NextResponse.json({ success: false, error: 'Çok fazla AI isteği. Lütfen bekleyin.' }, { status: 429 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON gövdesi.' }, { status: 400 });
    }

    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const history = Array.isArray(body?.history) ? body.history : [];
    const context = Array.isArray(body?.context) ? body.context : [];

    if (!message) {
      return NextResponse.json({ success: false, error: 'Mesaj gerekli.' }, { status: 400 });
    }
    if (message.length > 5000) {
      return NextResponse.json({ success: false, error: 'Mesaj çok uzun.' }, { status: 400 });
    }
    if (history.length > 200) {
      return NextResponse.json({ success: false, error: 'Geçmiş çok uzun.' }, { status: 400 });
    }
    if (context.length > 20) {
      return NextResponse.json({ success: false, error: 'Bağlam çok uzun.' }, { status: 400 });
    }

    if (API_KEYS.length === 0) {
         return NextResponse.json({ success: false, error: "API keys are missing." }, { status: 500 });
    }

    // 1. Resolve Images using logic from solve/route.ts
    let contextPrompt = "BAĞLAM - Seçili Sorular:\n";
    let imageParts: any[] = [];
    let firstResolvedImageUrl: string | null = null;
    let resolvedImageUrls: string[] = [];

    if (context && context.length > 0) {
      for (const q of context) {
        const questionId = typeof q?.id === 'string' ? q.id : 'unknown';
        const questionTitle = typeof q?.title === 'string' ? q.title : '';
        contextPrompt += `- [${questionId}] ${questionTitle}\n`;

        let resolvedImageUrl = sanitizeAllowedImageUrl(q?.imageUrl);
        if (q?.imageUrl && !resolvedImageUrl) {
            return NextResponse.json({ success: false, error: 'Geçersiz imageUrl.' }, { status: 400 });
        }

        // Only scrape for image URL if client didn't already resolve it
        if (!resolvedImageUrl && q?.bookId && questionId.includes('-q')) {
             try {
                const parts = questionId.split('-q');
                const testId = parts[0];
                const questionNumber = parts[1];

                const targetUrl = `https://www.dijidemi.com/Ogrenci/KitapTestDetay?kitapId=${q.bookId}&___layout`;
                const pageResponse = await requestDijidemiUpstream({
                    request,
                    userId: auth.userId,
                    url: targetUrl,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'text/html, */*; q=0.01',
                    },
                    body: new URLSearchParams({ id: testId }).toString(),
                    referrer: 'https://www.dijidemi.com/Ogrenci',
                });
                if (pageResponse instanceof NextResponse) {
                    return pageResponse;
                }

                if (pageResponse.ok) {
                    const html = await pageResponse.text();
                    const $ = cheerio.load(html);
                    const questionEl = $(`.rowSoru[data-soruno="${questionNumber}"]`);
                    const scrapedImageUrl = questionEl.attr('data-soruimg');

                    if (scrapedImageUrl && scrapedImageUrl.startsWith('/')) {
                        resolvedImageUrl = sanitizeAllowedImageUrl(`https://${ALLOWED_IMAGE_HOSTS[0]}${scrapedImageUrl}`);
                    } else {
                        resolvedImageUrl = sanitizeAllowedImageUrl(scrapedImageUrl);
                    }
                }
             } catch (e) {
                console.error("Image scraping failed for", questionId, e);
             }
        }

        if (resolvedImageUrl) {
            if (!firstResolvedImageUrl) firstResolvedImageUrl = resolvedImageUrl;
            resolvedImageUrls.push(resolvedImageUrl);
            const part = await fetchImagePart(resolvedImageUrl);
            if (part) imageParts.push(part);
        }
      }
    }

    // 2. Teacher Persona
    const systemPrompt = `
      Sen bir öğretmensin. Sadece ve sadece eğitim, okul dersleri, sınavlar ve öğrencilerinin sorduğu sorular ile ilgili içerik üretmelisin.
      Görevin öğrencilerin sorularını çözmek ve anlamadığı, takıldığı yerleri açıklayıcı bir dille anlatmaktır.

      KRİTİK KURAL: Eğitim ve ders dışı hiçbir konuya (günlük sohbet, magazin, siyaset, oyunlar vb. okul dışı başlıklar) girme, yorum yapma veya cevap verme.
      Eğer öğrenci ders dışı bir şey sorarsa, ona sadece eğitim ve soruları hakkında yardımcı olabileceğini nazikçe belirt ve konuyu derslere geri getir.

      Yanıtların nazik, teşvik edici ve pedagojik olmalı.

      Çözüm Kuralları:
      1. Eğer birden fazla soru resmi gönderildiyse, her bir soruyu "1. Soru", "2. Soru" şeklinde başlıklandırarak ÇOK NET BİR AYRIMLA çöz.
      2. Her bir soru için önce sorunun metnini/verilerini analiz et, sonra adım adım çözümü anlat.
      3. Her sorunun cevabını net bir şekilde belirt.
      4. Matematiksel ifadeleri MUTLAKA '$' (dolar) işareti içinde LaTeX formatında yaz.
      - ÖNEMLİ: '$' işaretini 'escape' etme (ters slash kullanma).
      - Örnek: $\\frac{1}{2}$, $x^2$, $\\sqrt{x}$
      - Paragraf blokları yapma, satır içi matematik kullan.

      ${contextPrompt}
    `;

    // 3. Chat History
    let historyText = "";
    if (history && history.length > 0) {
        history.slice(-6).forEach((msg: any) => {
            historyText += `${msg.role === 'user' ? 'Öğrenci' : 'Öğretmen'}: ${msg.content}\n`;
        });
    }

    const finalPrompt = `
      ${systemPrompt}

      Geçmiş Konuşma:
      ${historyText}

      Öğrenci: ${message}
      Öğretmen:
    `;

    // 4. Streaming with API key rotation
    let lastError;
    for (const [index, apiKey] of API_KEYS.entries()) {
        try {
            const model = getModel(apiKey);

            // generateContentStream throws on initial call for 429s etc.
            const result = await model.generateContentStream([
                ...imageParts,
                finalPrompt
            ]);

            // Stream started successfully — build SSE response
            const encoder = new TextEncoder();
            const readableStream = new ReadableStream({
                async start(controller) {
                    // Send meta event first
                    if (firstResolvedImageUrl || resolvedImageUrls.length > 0) {
                        const metaEvent = `data: ${JSON.stringify({
                            meta: {
                                resolvedImageUrl: firstResolvedImageUrl,
                                resolvedImageUrls
                            }
                        })}\n\n`;
                        controller.enqueue(encoder.encode(metaEvent));
                    }

                    let fullText = '';
                    try {
                        for await (const chunk of result.stream) {
                            const chunkText = chunk.text();
                            if (chunkText) {
                                fullText += chunkText;
                                const tokenEvent = `data: ${JSON.stringify({ token: chunkText })}\n\n`;
                                controller.enqueue(encoder.encode(tokenEvent));
                            }
                        }

                        // Send done event
                        const doneEvent = `data: ${JSON.stringify({ done: true, fullText })}\n\n`;
                        controller.enqueue(encoder.encode(doneEvent));
                    } catch (streamErr: any) {
                        console.error(`[Playground API] Stream error: ${streamErr.message?.substring(0, 100)}`);
                        const errorEvent = `data: ${JSON.stringify({ error: 'Yanıt akışı sırasında bir hata oluştu.' })}\n\n`;
                        controller.enqueue(encoder.encode(errorEvent));
                    } finally {
                        controller.close();
                    }
                }
            });

            return new Response(readableStream, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache, no-transform',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no',
                },
            });

        } catch (error: any) {
            console.error(`[Playground API] Key #${index + 1} failed: ${error.message?.substring(0, 50)}`);
            lastError = error;
            if (error.message?.includes('429')) continue;
            continue;
        }
    }

    throw lastError || new Error('All API keys failed');

  } catch (error: any) {
    console.error('AI Chat Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
    return NextResponse.json({ success: false, error: 'İstek işlenirken bir hata oluştu.' }, { status: 500 });
  }
}
