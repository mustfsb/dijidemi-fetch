import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { analyzeProgramPdf } from '@/lib/program-analyzer';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

const DATA_DIR = process.env.PROGRAM_CACHE_DIR?.trim() || '/tmp';
const DATA_FILE_PATH = path.join(DATA_DIR, 'program.json');

export async function GET(req: NextRequest) {
    // Auth check
    const auth = requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    console.log('API: Program getirme istegi alindi.');
    try {
        if (fs.existsSync(DATA_FILE_PATH)) {
            const data = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
            const schedule = JSON.parse(data);
            console.log('Kayitli program gonderiliyor.');
            return NextResponse.json({ success: true, schedule, source: 'cache' });
        } else {
            console.log('Kayitli program bulunamadi:', DATA_FILE_PATH);
            return NextResponse.json({ success: false, error: 'Henüz kayıtlı bir program yok.' }, { status: 404 });
        }
    } catch (error: any) {
        console.error('API Error (GET):', error instanceof Error ? error.message : 'Unknown');
        return NextResponse.json({ success: false, error: 'Program okunurken hata oluştu.' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    // Auth check
    const auth = requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    // Rate limit (HEAVY - triggers AI analysis + filesystem write)
    const ip = getClientIp(req);
    if (!RateLimits.HEAVY(ip, auth.userId)) {
        return NextResponse.json({ success: false, error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    console.log('API: Program analiz istegi alindi.');
    try {
        const filePath = path.join(process.cwd(), 'public', 'program.pdf');

        const schedule = await analyzeProgramPdf(filePath);
        console.log('AI Analizi basariyla tamamlandi.');

        // Persist to file
        try {
            // Ensure directory exists
            const dir = path.dirname(DATA_FILE_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(schedule, null, 2));
            console.log('Program diske kaydedildi.');
        } catch (writeError) {
            console.error('Program kaydedilemedi:', writeError instanceof Error ? writeError.message : 'Unknown');
            // We continue even if save fails, returning the analyzed data
        }

        return NextResponse.json({ success: true, schedule, source: 'ai' });

    } catch (error: any) {
        console.error('API Error:', error instanceof Error ? error.message : 'Unknown');
        return NextResponse.json({
            success: false,
            error: 'Sunucu hatası veya Gemini hatası.'
        }, { status: 500 });
    }
}
