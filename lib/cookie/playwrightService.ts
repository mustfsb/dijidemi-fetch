import { chromium } from 'playwright';

interface CookieData {
    'cf_clearance': string;
    'ASP.NET_SessionId': string;
    'usrtkn': string;
    [key: string]: string;
}

class PlaywrightService {
    private static instance: PlaywrightService;

    private constructor() { }

    public static getInstance(): PlaywrightService {
        if (!PlaywrightService.instance) {
            PlaywrightService.instance = new PlaywrightService();
        }
        return PlaywrightService.instance;
    }

    async getFreshCookies(): Promise<CookieData> {
        console.log('Starting Cloudflare bypass via Playwright...');

        let browser;

        // Check if running in Netlify/Lambda environment
        const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_VERSION || !!process.env.NETLIFY || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

        if (isLambda) {
            console.log('Running in Lambda/Netlify environment. Using @sparticuz/chromium');
            const sparticuzChromium = await import('@sparticuz/chromium');
            const { chromium: playwrightChromium } = await import('playwright-core');

            // @sparticuz/chromium v123+ might export 'default'
            const chromium = (sparticuzChromium.default || sparticuzChromium) as any;

            // Ensure we get a string path. Some versions require a location, others don't.
            // If this still fails with "Received undefined", it means the library can't find its local binary.
            // Externalizing in netlify.toml should fix the finding issue.
            const executablePath = await chromium.executablePath();

            browser = await playwrightChromium.launch({
                args: chromium.args,
                executablePath: executablePath,
                headless: chromium.headless,
            });

        } else {
            console.log('Running in local environment. Using standard playwright.');
            const { chromium } = await import('playwright');
            browser = await chromium.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled' // Stealth mode
                ]
            });
        }

        try {
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 },
                locale: 'tr-TR',
                timezoneId: 'Europe/Istanbul'
            });
            const page = await context.newPage();

            // Navigate to the login page
            console.log('Navigating to dijidemi.com/login...');
            await page.goto('https://www.dijidemi.com/login', {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });

            // Wait for Username field - this confirms we passed the initial CF/DDOS screen
            console.log('Waiting for login form...');
            try {
                await page.waitForSelector('#txtUserName', { state: 'visible', timeout: 30000 });
            } catch (e) {
                console.log('Login form not found immediately, might be in CF Challenge. Waiting longer...');
                await page.waitForTimeout(5000);
            }

            // Perform Login
            console.log('Attempting login...');
            try {
                // Determine if we are actually on the form
                const isFormVisible = await page.isVisible('#txtUserName');
                if (isFormVisible) {
                    await page.fill('#txtUserName', '14308-1651');
                    await page.fill('#txtPassword', '175F7');

                    // Click login
                    await page.click('#btnLogin');

                    console.log('Login clicked. Waiting for navigation...');

                    // Wait for successful login indicator (e.g. redirect out of /login)
                    // Or wait for network idle
                    await page.waitForLoadState('networkidle', { timeout: 30000 });
                } else {
                    console.error('Could not find login form. Possibly stuck on Cloudflare.');
                }

            } catch (loginError) {
                console.error('Login attempt failed or timed out:', loginError);
            }

            const cookies = await context.cookies();
            const cookieMap: CookieData = {
                'cf_clearance': '',
                'ASP.NET_SessionId': '',
                'usrtkn': ''
            };

            cookies.forEach(cookie => {
                if (cookie.name in cookieMap || ['cf_clearance', 'ASP.NET_SessionId', 'usrtkn'].includes(cookie.name)) {
                    cookieMap[cookie.name] = cookie.value;
                }
            });

            const missingCookies = Object.entries(cookieMap)
                .filter(([key, val]) => !val && ['cf_clearance', 'ASP.NET_SessionId'].includes(key)) // usrtkn might not always be there initially?
                .map(([key]) => key);

            if (missingCookies.length > 0) {
                console.warn(`Warning: Missing critical cookies: ${missingCookies.join(', ')}`);
            }

            console.log('Cookies retrieved successfully.');
            return cookieMap;

        } catch (error) {
            console.error('Error in PlaywrightService:', error);
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }
}

export const playwrightService = PlaywrightService.getInstance();
