import type { Browser, BrowserContext, Page, Response as PlaywrightResponse } from 'playwright';

export interface CookieData {
    cf_clearance: string;
    'ASP.NET_SessionId': string;
    usrtkn: string;
    '.ASPXAUTH': string;
    [key: string]: string;
}

export interface DijidemiLoginCredentials {
    username: string;
    password: string;
}

interface PlaywrightTimingConfig {
    isLambda: boolean;
    loginPageTimeoutMs: number;
    loginFormTimeoutMs: number;
    loginFormRetryMs: number;
    loginResponseTimeoutMs: number;
    postLoginIdleTimeoutMs: number;
    postLoginStabilizeMs: number;
}

type DijidemiLoginErrorCode =
    | 'browser_missing'
    | 'challenge_failed'
    | 'invalid_credentials'
    | 'upstream_error';

export class DijidemiLoginError extends Error {
    readonly code: DijidemiLoginErrorCode;

    constructor(code: DijidemiLoginErrorCode, message: string) {
        super(message);
        this.name = 'DijidemiLoginError';
        this.code = code;
    }
}

class PlaywrightService {
    private static instance: PlaywrightService;
    private static readonly USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
    private static readonly STEALTH_INIT_SCRIPT = `
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'Chrome PDF Plugin' },
                { name: 'Chrome PDF Viewer' },
                { name: 'Native Client' },
            ],
        });
        window.chrome = window.chrome || { runtime: {} };
    `;

    private constructor() { }

    public static getInstance(): PlaywrightService {
        if (!PlaywrightService.instance) {
            PlaywrightService.instance = new PlaywrightService();
        }
        return PlaywrightService.instance;
    }

    async getFreshCookies(credentials?: DijidemiLoginCredentials): Promise<CookieData> {
        const resolvedCredentials = this.resolveCredentials(credentials);
        const timings = this.getTimingConfig();

        // On Lambda/Netlify, use direct HTTP (mobile UA) instead of a headless browser.
        // Cloudflare's browser challenge cannot be solved by headless Chrome on AWS Lambda
        // IPs because cf_clearance is IP-bound. The mobile app UA bypasses the browser
        // challenge entirely as long as a valid cf_clearance is present in Supabase.
        if (timings.isLambda) {
            return this.getFreshCookiesViaDirectHttp(resolvedCredentials);
        }

        console.log('Starting Dijidemi login via Playwright (local)...');
        let browser: Browser | null = null;

        try {
            browser = await this.launchBrowser(false /* local */);
            const context = await this.createContext(browser);

            const page = await context.newPage();
            await this.ensureLoginForm(page, timings);
            await this.performLogin(page, resolvedCredentials, timings);
            await this.ensureAuthenticatedSession(page, context);

            const cookies = this.extractCookieMap(await context.cookies());
            if (cookies['ASP.NET_SessionId'] && !cookies.usrtkn) {
                cookies.usrtkn = `tkn=${cookies['ASP.NET_SessionId']}`;
            }

            if (!cookies.cf_clearance || !cookies['ASP.NET_SessionId']) {
                const loginErrorText = await this.readLoginFailureMessage(page);
                if (loginErrorText) {
                    throw new DijidemiLoginError('invalid_credentials', loginErrorText);
                }
                throw new DijidemiLoginError(
                    'challenge_failed',
                    'Dijidemi oturumu alınamadı. Cloudflare challenge tamamlanamadı.'
                );
            }

            console.log('Dijidemi cookies retrieved successfully.');
            return cookies;
        } catch (error) {
            if (error instanceof DijidemiLoginError) {
                throw error;
            }

            if (this.isTargetClosedError(error)) {
                throw new DijidemiLoginError(
                    'challenge_failed',
                    'Tarayıcı oturumu Cloudflare doğrulaması sırasında kapandı. Sunucu zaman aşımı oluşmuş olabilir.'
                );
            }

            const message = error instanceof Error ? error.message : 'Unknown Playwright login error';
            throw new DijidemiLoginError('upstream_error', message);
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    private async getFreshCookiesViaDirectHttp(credentials: DijidemiLoginCredentials): Promise<CookieData> {
        console.log('[PlaywrightService] Lambda mode: using direct HTTP login (mobile UA)...');

        // Load existing cookies (esp. cf_clearance) from Supabase
        let existingCookies: Array<{ name: string; value: string }> = [];
        try {
            const { supabase } = await import('@/lib/db/supabase');
            const { data } = await supabase
                .from('auth_cookies')
                .select('cookie_json')
                .order('updated_at', { ascending: false })
                .limit(1)
                .single();

            if (data?.cookie_json) {
                const parsed = typeof data.cookie_json === 'string'
                    ? JSON.parse(data.cookie_json)
                    : data.cookie_json;
                existingCookies = Object.entries(parsed)
                    .filter(([, v]) => Boolean(v))
                    .map(([name, value]) => ({ name, value: String(value) }));
            }
        } catch (err) {
            console.warn('[PlaywrightService] Could not load existing cookies from Supabase:', err);
        }

        const hasCfClearance = existingCookies.some(c => c.name === 'cf_clearance' && c.value);
        if (!hasCfClearance) {
            throw new DijidemiLoginError(
                'challenge_failed',
                'Cloudflare oturumu bulunamadı. Lütfen yerel makinede "npm run seed-cookies" çalıştırın.'
            );
        }

        const { directLoginDijidemi } = await import('@/lib/dijidemi/directFetch');
        const result = await directLoginDijidemi(credentials.username, credentials.password, existingCookies);

        if (!result.success) {
            const code = (result.error ?? '').includes('şifre') ? 'invalid_credentials' : 'challenge_failed';
            throw new DijidemiLoginError(code, result.error ?? 'Dijidemi giriş başarısız');
        }

        const cookies: CookieData = {
            cf_clearance: result.cookies['cf_clearance'] ?? '',
            'ASP.NET_SessionId': result.cookies['ASP.NET_SessionId'] ?? '',
            usrtkn: result.cookies['usrtkn'] ?? '',
            '.ASPXAUTH': result.cookies['.ASPXAUTH'] ?? '',
        };

        if (!cookies.cf_clearance || !cookies['ASP.NET_SessionId']) {
            throw new DijidemiLoginError(
                'challenge_failed',
                'Dijidemi oturumu alınamadı. Yeni session cookie bulunamadı.'
            );
        }

        console.log('[PlaywrightService] Direct HTTP login successful.');
        return cookies;
    }

    private resolveCredentials(credentials?: DijidemiLoginCredentials): DijidemiLoginCredentials {
        const username = credentials?.username?.trim() || process.env.DIJIDEMI_USERNAME?.trim() || '';
        const password = credentials?.password?.trim() || process.env.DIJIDEMI_PASSWORD?.trim() || '';

        if (!username || !password) {
            throw new DijidemiLoginError(
                'upstream_error',
                'DIJIDEMI_USERNAME ve DIJIDEMI_PASSWORD yapılandırılmamış.'
            );
        }

        return { username, password };
    }

    private async launchBrowser(isLambda: boolean): Promise<Browser> {
        try {
            if (isLambda) {
                console.log('Running in Lambda/Netlify environment. Using @sparticuz/chromium');
                const sparticuzChromium = await import('@sparticuz/chromium');
                const { chromium: playwrightChromium } = await import('playwright-core');
                const chromium = (sparticuzChromium.default || sparticuzChromium) as unknown as {
                    args: string[];
                    executablePath: () => Promise<string>;
                    headless?: boolean;
                };

                return playwrightChromium.launch({
                    args: chromium.args,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless ?? true,
                });
            }

            console.log('Running in local environment. Using standard playwright.');
            const { chromium } = await import('playwright');
            return chromium.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                ],
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown Playwright launch error';
            if (message.includes('Executable doesn\'t exist')) {
                throw new DijidemiLoginError(
                    'browser_missing',
                    'Playwright browser binary bulunamadı. `npx playwright install chromium` çalıştırılmalı.'
                );
            }
            throw new DijidemiLoginError('upstream_error', message);
        }
    }

    private async loadCfClearanceFromSupabase(): Promise<string | null> {
        try {
            const { supabase } = await import('@/lib/db/supabase');
            const { data } = await supabase
                .from('auth_cookies')
                .select('cookie_json')
                .order('updated_at', { ascending: false })
                .limit(1)
                .single();

            if (data?.cookie_json) {
                const parsed = typeof data.cookie_json === 'string'
                    ? JSON.parse(data.cookie_json)
                    : data.cookie_json;
                const cfClearance = parsed['cf_clearance'];
                if (cfClearance) {
                    console.log('[PlaywrightService] Pre-loading cf_clearance from Supabase.');
                    return cfClearance;
                }
            }
        } catch (err) {
            console.warn('[PlaywrightService] Could not load cf_clearance from Supabase:', err);
        }
        return null;
    }

    private async createContext(browser: Browser, preCfClearance?: string | null): Promise<BrowserContext> {
        const context = await browser.newContext({
            userAgent: PlaywrightService.USER_AGENT,
            viewport: { width: 1280, height: 720 },
            locale: 'tr-TR',
            timezoneId: 'Europe/Istanbul',
            javaScriptEnabled: true,
        });

        await context.addInitScript({ content: PlaywrightService.STEALTH_INIT_SCRIPT });
        await context.setExtraHTTPHeaders({
            'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        });

        if (preCfClearance) {
            await context.addCookies([{
                name: 'cf_clearance',
                value: preCfClearance,
                domain: '.dijidemi.com',
                path: '/',
                httpOnly: false,
                secure: true,
                sameSite: 'None',
            }]);
        }

        return context;
    }

    private getTimingConfig(): PlaywrightTimingConfig {
        const isLambda = Boolean(
            process.env.AWS_LAMBDA_FUNCTION_VERSION
            || process.env.NETLIFY
            || process.env.AWS_LAMBDA_FUNCTION_NAME
        );

        if (isLambda) {
            return {
                isLambda,
                loginPageTimeoutMs: 15000,
                loginFormTimeoutMs: 8000,
                loginFormRetryMs: 3000,
                loginResponseTimeoutMs: 10000,
                postLoginIdleTimeoutMs: 5000,
                postLoginStabilizeMs: 1500,
            };
        }

        return {
            isLambda,
            loginPageTimeoutMs: 60000,
            loginFormTimeoutMs: 15000,
            loginFormRetryMs: 5000,
            loginResponseTimeoutMs: 12000,
            postLoginIdleTimeoutMs: 6000,
            postLoginStabilizeMs: 1500,
        };
    }

    private async ensureLoginForm(page: Page, timings: PlaywrightTimingConfig): Promise<void> {
        console.log('Navigating to dijidemi.com/login...');
        await page.goto('https://www.dijidemi.com/login', {
            waitUntil: 'domcontentloaded',
            timeout: timings.loginPageTimeoutMs,
        });

        try {
            await page.waitForSelector('#txtUserName', {
                state: 'visible',
                timeout: timings.loginFormTimeoutMs,
            });
            return;
        } catch (error) {
            if (this.isTargetClosedError(error)) {
                throw new DijidemiLoginError(
                    'challenge_failed',
                    'Tarayıcı oturumu login formu beklenirken kapandı.'
                );
            }

            if (await this.isChallengePage(page)) {
                await page.waitForTimeout(timings.loginFormRetryMs).catch(() => undefined);
                const loginFormVisible = await page.locator('#txtUserName').isVisible().catch(() => false);
                if (loginFormVisible) {
                    return;
                }
            }

            const failureText = await this.readChallengeMessage(page);
            throw new DijidemiLoginError(
                'challenge_failed',
                failureText || 'Cloudflare challenge çözülemedi; login formu görünmedi.'
            );
        }
    }

    private async performLogin(
        page: Page,
        credentials: DijidemiLoginCredentials,
        timings: PlaywrightTimingConfig
    ): Promise<void> {
        const loginResponsePromise = page.waitForResponse(
            (response) => response.url().includes('/Login/UserLogin') && response.request().method() === 'POST',
            { timeout: timings.loginResponseTimeoutMs }
        ).catch(() => null);

        await page.fill('#txtUserName', credentials.username);
        await page.fill('#txtPassword', credentials.password);
        await page.click('#btnLogin');

        const loginResponse = await loginResponsePromise;
        if (loginResponse) {
            await this.handleLoginResponse(loginResponse);
        }

        await page.waitForLoadState('networkidle', { timeout: timings.postLoginIdleTimeoutMs }).catch(() => undefined);
        await page.waitForTimeout(timings.postLoginStabilizeMs).catch(() => undefined);
        const loginErrorText = await this.readLoginFailureMessage(page);
        if (loginErrorText) {
            throw new DijidemiLoginError('invalid_credentials', loginErrorText);
        }
    }

    private async ensureAuthenticatedSession(page: Page, context: BrowserContext): Promise<void> {
        // ASP.NET_SessionId is set from the 302 redirect response headers, before the redirect
        // destination page loads. If it's already in the context, the session is valid even if
        // the current page is a Cloudflare challenge page.
        const earlyCheck = this.extractCookieMap(await context.cookies());
        if (earlyCheck['ASP.NET_SessionId']) {
            return;
        }

        // Session cookie not yet available — wait for challenge to resolve (up to 15s)
        if (await this.isChallengePage(page)) {
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline) {
                await page.waitForTimeout(1500).catch(() => undefined);
                const stillChallenge = await this.isChallengePage(page);
                if (!stillChallenge) break;
            }
            if (await this.isChallengePage(page)) {
                throw new DijidemiLoginError(
                    'challenge_failed',
                    'Dijidemi oturumu oluşturuldu ancak korumalı sayfa Cloudflare doğrulamasında takıldı.'
                );
            }
        }

        const currentUrl = page.url().toLowerCase();
        if (currentUrl.includes('/login')) {
            const loginErrorText = await this.readLoginFailureMessage(page);
            if (loginErrorText) {
                throw new DijidemiLoginError('invalid_credentials', loginErrorText);
            }
            throw new DijidemiLoginError(
                'challenge_failed',
                'Giriş sonrası korumalı sayfaya yönlendirme tamamlanamadı.'
            );
        }
    }

    private async handleLoginResponse(response: PlaywrightResponse): Promise<void> {
        const status = response.status();
        if (status === 401) {
            throw new DijidemiLoginError('invalid_credentials', 'Kullanıcı adı veya şifre hatalı.');
        }
        if (status >= 400) {
            throw new DijidemiLoginError('upstream_error', `Dijidemi login upstream hatası: ${status}`);
        }

        const contentType = response.headers()['content-type'] || '';
        if (!contentType.includes('application/json')) {
            return;
        }

        try {
            const payload = await response.json() as Record<string, unknown>;
            const success = payload.Success ?? payload.success;
            if (success === false) {
                const message = typeof payload.Message === 'string'
                    ? payload.Message
                    : typeof payload.message === 'string'
                        ? payload.message
                        : 'Kullanıcı adı veya şifre hatalı.';
                throw new DijidemiLoginError('invalid_credentials', message);
            }
        } catch (error) {
            if (error instanceof DijidemiLoginError) {
                throw error;
            }
        }
    }

    private extractCookieMap(cookies: Awaited<ReturnType<BrowserContext['cookies']>>): CookieData {
        const cookieMap: CookieData = {
            cf_clearance: '',
            'ASP.NET_SessionId': '',
            usrtkn: '',
            '.ASPXAUTH': '',
        };

        for (const cookie of cookies) {
            if (cookie.name in cookieMap) {
                cookieMap[cookie.name] = cookie.value;
            }
        }

        return cookieMap;
    }

    private isTargetClosedError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        return (
            error.message.includes('Target page, context or browser has been closed')
            || error.message.includes('Target closed')
        );
    }

    private async isChallengePage(page: Page): Promise<boolean> {
        const title = (await page.title().catch(() => '')).trim().toLowerCase();
        const bodyText = (await page.locator('body').textContent().catch(() => null))?.trim().toLowerCase() || '';
        const haystack = `${title}\n${bodyText}`;

        return (
            haystack.includes('just a moment')
            || haystack.includes('bir dakika lütfen')
            || haystack.includes('enable javascript and cookies to continue')
            || haystack.includes('güvenlik doğrulaması gerçekleştirme')
        );
    }

    private async readChallengeMessage(page: Page): Promise<string | null> {
        const title = (await page.title().catch(() => '')).trim();
        const bodyText = (await page.locator('body').textContent().catch(() => null))?.trim() || '';
        if (!bodyText) return null;

        const normalized = `${title}\n${bodyText}`.toLowerCase();
        if (normalized.includes('just a moment') || normalized.includes('bir dakika lütfen')) {
            return 'Cloudflare challenge sayfası geçilemedi.';
        }
        if (normalized.includes('enable javascript and cookies')) {
            return 'Cloudflare challenge JavaScript/cookie doğrulamasını tamamlayamadı.';
        }
        if (normalized.includes('güvenlik doğrulaması gerçekleştirme')) {
            return 'Cloudflare güvenlik doğrulaması korumalı sayfada tamamlanamadı.';
        }

        return null;
    }

    private async readLoginFailureMessage(page: Page): Promise<string | null> {
        const selectors = [
            '.validation-summary-errors',
            '.alert-danger',
            '.text-danger',
            '#lblError',
            '.login-error',
        ];

        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            const isVisible = await locator.isVisible().catch(() => false);
            if (!isVisible) continue;

            const text = (await locator.textContent().catch(() => null))?.trim();
            if (text) {
                return text;
            }
        }

        const bodyText = (await page.locator('body').textContent().catch(() => null))?.trim() || '';
        if (!bodyText) return null;

        const lowered = bodyText.toLowerCase();
        if (
            lowered.includes('hatalı')
            || lowered.includes('yanlış')
            || lowered.includes('geçersiz')
            || lowered.includes('bulunamadı')
        ) {
            return 'Kullanıcı adı veya şifre hatalı.';
        }

        return null;
    }
}

export const playwrightService = PlaywrightService.getInstance();
