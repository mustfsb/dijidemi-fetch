import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { analyzeProgramPdf } from '@/lib/program-analyzer';

const DB_PATH = path.join(process.cwd(), 'program-db.json');

export async function GET(req: NextRequest) {
    console.log('🚀 API: Program getirme isteği alındı.');
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf-8');
            const schedule = JSON.parse(data);
            console.log('✅ Kayıtlı program gönderiliyor.');
            return NextResponse.json({ success: true, schedule, source: 'cache' });
        } else {
            console.log('⚠️ Kayıtlı program bulunamadı.');
            return NextResponse.json({ success: false, error: 'Henüz kayıtlı bir program yok.' }, { status: 404 });
        }
    } catch (error: any) {
        console.error('API Error (GET):', error);
        return NextResponse.json({ success: false, error: 'Program okunurken hata oluştu.' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    console.log('🚀 API: Program analiz isteği alındı.');
    try {
        const filePath = path.join(process.cwd(), 'public', 'program.pdf');
        console.log(`📂 PDF Dosya Yolu: ${filePath}`);

        const schedule = await analyzeProgramPdf(filePath);
        console.log('✅ AI Analizi başarıyla tamamlandı.');

        // Persist to file
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify(schedule, null, 2));
            console.log('💾 Program diske kaydedildi.');
        } catch (writeError) {
            console.error('⚠️ Program kaydedilemedi:', writeError);
            // We continue even if save fails, returning the analyzed data
        }

        return NextResponse.json({ success: true, schedule, source: 'ai' });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Sunucu hatası veya Gemini hatası.'
        }, { status: 500 });
    }
}
