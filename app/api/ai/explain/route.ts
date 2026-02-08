import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
// WARNING: Ideally use an environment variable. For now, we'll try to use the one from process.env if available, 
// or fail gracefully if not. The user has likely set up the env from previous tasks.
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

export async function POST(request: NextRequest) {
    try {
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
