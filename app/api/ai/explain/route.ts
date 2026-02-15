import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

export async function POST(request: NextRequest) {
    try {
        // Auth check
        const auth = requireAuth(request);
        if (auth instanceof NextResponse) return auth;

        // Rate limit (AI is costly)
        const ip = getClientIp(request);
        if (!RateLimits.AI(ip)) {
            return NextResponse.json({ error: 'Çok fazla AI isteği. Lütfen bekleyin.' }, { status: 429 });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'API Key not configured' }, { status: 500 });
        }

        const body = await request.json();
        const { questionContext, userNote } = body;

        let prompt = `Sen bir uzman öğretmensin. Öğrenci şu soru hakkında yardım istiyor: \n\nKonu/Bağlam: ${questionContext}\n`;

        if (userNote) {
            prompt += `Öğrenci Notu: "${userNote}"\n`;
        }

        prompt += `\nLütfen bu soruyu veya konuyu anlaşılır, samimi ve eğitici bir dille açıkla. Çözümü adım adım anlat.`;

        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        return NextResponse.json({ success: true, explanation: text });

    } catch (error) {
        console.error('AI Error:', error);
        return NextResponse.json({ error: 'AI yanıt veremedi.' }, { status: 500 });
    }
}
