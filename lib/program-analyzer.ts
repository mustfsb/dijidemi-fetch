import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function analyzeProgramPdf(filePath: string) {
    if (!fs.existsSync(filePath)) {
        throw new Error('PDF file not found at ' + filePath);
    }

    console.log('📄 PDF okunuyor ve Base64 formatına çevriliyor...');
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');

    console.log('🤖 Gemini AI (1.5-flash) çağrılıyor, lütfen bekleyin...');
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

    const prompt = `
        Bu bir haftalık ders çalışma programı (PDF). Bu programı analiz et ve aşağıdaki JSON formatında bir veri döndür.
        JSON dışında hiçbir metin yazma.
        
        Örnek JSON formatı:
        {
            "startDate": "2024-01-01", // Eğer tarih yoksa bugünün tarihini atabilirsin veya boş bırakabilirsin.
            "tasks": [
                {
                    "id": "unique_id_1",
                    "day": "Pazartesi",
                    "subject": "Matematik",
                    "name": "Etap-3", // Ödevin adı veya konusu
                    "pageRange": "80-84", // Sayfa aralığı (varsa)
                    "completed": false
                }
            ]
        }

        Notlar:
        - "name" alanı "Etap-X" veya konu başlığı gibi belirgin ifadeleri içermeli.
        - "pageRange" alanını metinden çıkarabildiğin kadar çıkar (örn: "Sayfa 80-84", "s.80-84" -> "80-84"). Yoksa boş bırak.
        - "subject" alanı ders adını içermeli (Matematik, Fizik, vb.).
    `;

    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: base64Data,
                mimeType: 'application/pdf',
            },
        },
    ]);

    const response = await result.response;
    const text = response.text();

    // Basic JSON cleanup
    let jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
        const schedule = JSON.parse(jsonStr);
        // Add IDs if missing
        if (schedule.tasks) {
            schedule.tasks = schedule.tasks.map((t: any) => {
                // Create a deterministic ID for merging status later
                const cleanId = `${t.day}-${t.subject}-${t.name}-${t.pageRange || ''}`.replace(/\s+/g, '-').toLowerCase();
                return {
                    ...t,
                    id: cleanId,
                    completed: false
                };
            });

            // Deduplicate tasks based on ID
            const seenIds = new Set();
            const uniqueTasks: any[] = [];
            for (const task of schedule.tasks) {
                if (!seenIds.has(task.id)) {
                    seenIds.add(task.id);
                    uniqueTasks.push(task);
                }
            }
            schedule.tasks = uniqueTasks;
        }
        return schedule;
    } catch (e) {
        console.error('JSON Parse Error:', e);
        throw new Error('AI response could not be parsed as JSON: ' + text);
    }
}
