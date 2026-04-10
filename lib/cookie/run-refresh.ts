import { playwrightService } from './playwrightService';

async function main() {
    console.log('Forcefully refreshing cookies via Playwright...');

    try {
        const startTime = Date.now();
        const cookies = await playwrightService.getFreshCookies();

        // Enhance usrtkn if missing
        if (cookies['ASP.NET_SessionId'] && !cookies['usrtkn']) {
            cookies['usrtkn'] = `tkn=${cookies['ASP.NET_SessionId']}`;
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`\n🎉 Process completed in ${duration}s`);
        console.log('Cookie refresh complete. Keys:', Object.keys(cookies).sort());

        const hasCf = !!cookies['cf_clearance'];
        const hasSession = !!cookies['ASP.NET_SessionId'];

        if (hasCf && hasSession) {
            console.log('\n✅ SUCCESS: Cookies refreshed.');
        } else {
            console.error('\n❌ FAILURE: Missing critical cookies.');
        }

    } catch (error) {
        console.error('Error during update:', error);
        process.exit(1);
    }
}

main();
