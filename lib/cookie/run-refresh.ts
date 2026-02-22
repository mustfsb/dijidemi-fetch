import fs from 'fs';
import path from 'path';
import { playwrightService } from './playwrightService';

function saveCookies(cookies: any) {
    try {
        const baseDir = process.env.COOKIE_BACKUP_DIR?.trim() || '/tmp';
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        const filePath = path.join(baseDir, 'cookies.json');
        fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
        console.log('Saved cookies to ' + filePath);
    } catch (error) {
        console.error('Error saving cookies locally:', error);
    }
}

async function main() {
    console.log('Forcefully refreshing cookies via Playwright...');

    try {
        const startTime = Date.now();
        const cookies = await playwrightService.getFreshCookies();

        // Enhance usrtkn if missing
        if (cookies['ASP.NET_SessionId'] && !cookies['usrtkn']) {
            cookies['usrtkn'] = `tkn=${cookies['ASP.NET_SessionId']}`;
        }

        saveCookies(cookies);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`\n🎉 Process completed in ${duration}s`);
        console.log('--- Retrieved & Saved Cookies ---');
        console.log(JSON.stringify(cookies, null, 2));

        const hasCf = !!cookies['cf_clearance'];
        const hasSession = !!cookies['ASP.NET_SessionId'];

        if (hasCf && hasSession) {
            console.log('\n✅ SUCCESS: Cookies refreshed and saved to runtime backup path');
        } else {
            console.error('\n❌ FAILURE: Missing critical cookies.');
        }

    } catch (error) {
        console.error('Error during update:', error);
        process.exit(1);
    }
}

main();
