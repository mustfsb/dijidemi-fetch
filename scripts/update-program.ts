import { analyzeProgramPdf } from '../lib/program-analyzer';
import fs from 'fs';
import path from 'path';

// Manual env loading if not already loaded (e.g. by node --env-file)
if (!process.env.GEMINI_API_KEY && fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            process.env[key.trim()] = valueParts.join('=').trim();
        }
    });
}

async function main() {
    try {
        console.log('--- Program Analiz Ediliyor ---');
        const pdfPath = path.join(process.cwd(), 'public', 'program.pdf');
        const outputPath = path.join(process.cwd(), 'app', 'data', 'program.json');

        if (!fs.existsSync(pdfPath)) {
            console.error('Hata: public/program.pdf dosyası bulunamadı.');
            process.exit(1);
        }

        const schedule = await analyzeProgramPdf(pdfPath);

        // Ensure data directory exists
        const dataDir = path.dirname(outputPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(outputPath, JSON.stringify(schedule, null, 2));
        console.log('--- Program Başarıyla Güncellendi: app/data/program.json ---');
    } catch (error) {
        console.error('Hata:', error);
        process.exit(1);
    }
}

main();
