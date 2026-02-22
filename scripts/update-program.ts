/**
 * update-program.ts
 * 
 * Build-time script: reads public/program.pdf, sends it to Gemini AI,
 * and writes the parsed schedule to app/data/program.json.
 * 
 * Runs automatically before `next build` via the "build" npm script.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Resolve project root relative to this script file (scripts/ → one level up)
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Load environment variables from .env.local (needed for local runs and some CI envs)
dotenv.config({ path: path.join(PROJECT_ROOT, '.env.local') });

const PDF_PATH = path.join(PROJECT_ROOT, 'public', 'program.pdf');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'app', 'data', 'program.json');

async function analyzeProgramPdf(filePath: string): Promise<any> {
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not set.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `
        Bu bir haftalık ders çalışma programı (PDF). Bu programı analiz et ve aşağıdaki JSON formatında bir veri döndür.
        JSON dışında hiçbir metin yazma.
        
        Örnek JSON formatı:
        {
            "startDate": "2024-01-01",
            "tasks": [
                {
                    "id": "unique_id_1",
                    "day": "Pazartesi",
                    "subject": "Matematik",
                    "name": "Etap-3",
                    "pageRange": "80-84",
                    "completed": false
                }
            ]
        }

        Notlar:
        - "name" alanı "Etap-X" veya konu başlığı gibi belirgin ifadeleri içermeli.
        - "pageRange" alanını metinden çıkarabildiğin kadar çıkar (örn: "Sayfa 80-84", "s.80-84" -> "80-84"). Yoksa boş bırak.
        - "subject" alanı ders adını içermeli (Matematik, Fizik, vb.).
        - "startDate" alanı için PDF'de tarih yoksa bugünün tarihini kullan.
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

    // Clean up markdown code fences if present
    let jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();

    const schedule = JSON.parse(jsonStr);

    if (schedule.tasks) {
        // Generate deterministic IDs and deduplicate
        const seenIds = new Set<string>();
        const uniqueTasks: any[] = [];

        schedule.tasks.forEach((t: any) => {
            const cleanId = `${t.day}-${t.subject}-${t.name}-${t.pageRange || ''}`
                .replace(/\s+/g, '-')
                .toLowerCase();
            const task = { ...t, id: cleanId, completed: false };
            if (!seenIds.has(cleanId)) {
                seenIds.add(cleanId);
                uniqueTasks.push(task);
            }
        });

        schedule.tasks = uniqueTasks;
    }

    return schedule;
}

async function main() {
    console.log('🚀 Program güncelleme scripti başlatıldı...');

    if (!fs.existsSync(PDF_PATH)) {
        console.warn(`⚠️  PDF bulunamadı: ${PDF_PATH}`);
        console.warn('   program.json güncellenmeyecek, mevcut dosya korunacak.');
        process.exit(0); // Don't fail the build if PDF is missing
    }

    console.log(`📄 PDF okunuyor: ${PDF_PATH}`);

    try {
        console.log('🤖 Gemini AI analiz ediyor...');
        const schedule = await analyzeProgramPdf(PDF_PATH);

        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(schedule, null, 2), 'utf-8');
        console.log(`✅ program.json başarıyla güncellendi: ${OUTPUT_PATH}`);
        console.log(`   ${schedule.tasks?.length ?? 0} görev yazıldı.`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Program analizi başarısız:', error instanceof Error ? error.message : error);
        console.warn('   Mevcut program.json korunacak, build devam edecek.');
        process.exit(0); // Don't fail the build on AI errors — keep existing data
    }
}

main();
