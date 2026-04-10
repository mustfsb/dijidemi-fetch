import type { Browser } from 'playwright-core';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

const STEALTH_INIT_SCRIPT = `
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

// Headers that the browser manages automatically — must not be passed via page.evaluate fetch()
const FORBIDDEN_BROWSER_HEADERS = new Set([
    'accept-encoding',
    'connection',
    'content-length',
    'cookie',
    'host',
    'origin',
    'priority',
    'referer',
    'user-agent',
]);

function filterBrowserHeaders(headers?: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers || {})) {
        const normalized = key.toLowerCase();
        if (FORBIDDEN_BROWSER_HEADERS.has(normalized) || normalized.startsWith('sec-')) {
            continue;
        }
        result[key] = value;
    }
    return result;
}

declare global {
    // eslint-disable-next-line no-var
    var __dijidemiProductionBrowser: Browser | undefined;
}

async function getBrowser(): Promise<Browser> {
    if (globalThis.__dijidemiProductionBrowser?.isConnected()) {
        return globalThis.__dijidemiProductionBrowser;
    }

    const isLambda = Boolean(
        process.env.NETLIFY
        || process.env.AWS_LAMBDA_FUNCTION_NAME
        || process.env.AWS_LAMBDA_FUNCTION_VERSION
    );

    let browser: Browser;

    if (isLambda) {
        const sparticuzChromium = await import('@sparticuz/chromium');
        const { chromium: playwrightChromium } = await import('playwright-core');
        const chromium = (sparticuzChromium.default || sparticuzChromium) as unknown as {
            args: string[];
            executablePath: () => Promise<string>;
            headless?: boolean;
        };

        browser = await playwrightChromium.launch({
            args: chromium.args,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless ?? true,
        });
    } else {
        const { chromium } = await import('playwright');
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
        });
    }

    globalThis.__dijidemiProductionBrowser = browser;

    // Clear global reference if browser disconnects so next call relaunches
    browser.on('disconnected', () => {
        if (globalThis.__dijidemiProductionBrowser === browser) {
            globalThis.__dijidemiProductionBrowser = undefined;
        }
    });

    return browser;
}

export interface BrowserFetchRequest {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    additionalCookies?: Record<string, string | number | null | undefined>;
    referrer?: string;
}

export interface BrowserFetchResponse {
    status: number;
    url: string;
    headers: Record<string, string>;
    body: string;
}

async function createBrowserContext(
    browser: import('playwright-core').Browser,
    cookies: Array<{ name: string; value: string }>
): Promise<import('playwright-core').BrowserContext> {
    const context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 1280, height: 720 },
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul',
        javaScriptEnabled: true,
    });

    await context.addInitScript({ content: STEALTH_INIT_SCRIPT });
    await context.setExtraHTTPHeaders({
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    const allCookies: Array<{ name: string; value: string; domain: string; path: string }> = [
        ...cookies.map(c => ({ name: c.name, value: c.value, domain: '.dijidemi.com', path: '/' })),
    ];
    await context.addCookies(allCookies);

    return context;
}

/**
 * Fetches multiple Dijidemi URLs from a single browser context (one navigation).
 * All requests are fired in parallel after navigating to the referrer page once.
 * Significantly faster than creating a separate browser context per request.
 *
 * `onResult(index, result | null)` is called as each request completes, enabling
 * streaming SSE responses from the caller.
 */
export async function fetchManyViaBrowser(
    requests: BrowserFetchRequest[],
    cookies: Array<{ name: string; value: string }>,
    onResult: (index: number, result: BrowserFetchResponse | null) => void
): Promise<void> {
    if (requests.length === 0) return;

    const browser = await getBrowser();
    const referrer = requests.find(r => r.referrer)?.referrer || 'https://www.dijidemi.com/Lms/Index';

    const context = await createBrowserContext(browser, cookies);
    const page = await context.newPage();

    try {
        await page.goto(referrer, { waitUntil: 'domcontentloaded', timeout: 15000 });

        await Promise.all(
            requests.map(async (req, index) => {
                const filteredHeaders = filterBrowserHeaders(req.headers);
                try {
                    const result = await page.evaluate(
                        async ({ url, method, body, headers, ref }) => {
                            const response = await fetch(url, {
                                method: method || 'GET',
                                body: body ?? undefined,
                                headers,
                                credentials: 'include',
                                redirect: 'follow',
                                referrer: ref ?? '',
                                referrerPolicy: 'strict-origin-when-cross-origin',
                            });
                            return {
                                status: response.status,
                                url: response.url,
                                headers: Object.fromEntries(response.headers.entries()),
                                body: await response.text(),
                            };
                        },
                        {
                            url: req.url,
                            method: req.method || 'GET',
                            body: req.body ?? null,
                            headers: filteredHeaders,
                            ref: req.referrer ?? null,
                        }
                    );
                    onResult(index, result);
                } catch {
                    onResult(index, null);
                }
            })
        );
    } finally {
        await page.close().catch(() => undefined);
        await context.close().catch(() => undefined);
    }
}

/**
 * Makes a Dijidemi request through a real Chromium browser context, preserving
 * Chrome's TLS fingerprint so Cloudflare does not block the request.
 *
 * The browser instance is reused across warm Netlify function invocations.
 * A fresh context (and page) is created and closed for each request.
 */
export async function fetchViaBrowser(
    request: BrowserFetchRequest,
    cookies: Array<{ name: string; value: string }>
): Promise<BrowserFetchResponse> {
    const browser = await getBrowser();

    const context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 1280, height: 720 },
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul',
        javaScriptEnabled: true,
    });

    await context.addInitScript({ content: STEALTH_INIT_SCRIPT });
    await context.setExtraHTTPHeaders({
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    // Inject shared automation cookies + any additional per-request cookies
    const allCookies: Array<{ name: string; value: string; domain: string; path: string }> = [
        ...cookies.map(c => ({ name: c.name, value: c.value, domain: '.dijidemi.com', path: '/' })),
    ];

    if (request.additionalCookies) {
        for (const [name, raw] of Object.entries(request.additionalCookies)) {
            if (raw === null || raw === undefined) continue;
            const value = String(raw).trim();
            if (!value) continue;
            allCookies.push({ name, value, domain: '.dijidemi.com', path: '/' });
        }
    }

    await context.addCookies(allCookies);

    const page = await context.newPage();

    try {
        // Navigate to a Dijidemi page first to establish same-origin context for fetch()
        const landingUrl = request.referrer || 'https://www.dijidemi.com/Lms/Index';
        await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        const filteredHeaders = filterBrowserHeaders(request.headers);

        const result = await page.evaluate(
            async ({ url, method, body, headers, referrer }) => {
                const response = await fetch(url, {
                    method: method || 'GET',
                    body: body ?? undefined,
                    headers,
                    credentials: 'include',
                    redirect: 'follow',
                    referrer: referrer ?? '',
                    referrerPolicy: 'strict-origin-when-cross-origin',
                });
                return {
                    status: response.status,
                    url: response.url,
                    headers: Object.fromEntries(response.headers.entries()),
                    body: await response.text(),
                };
            },
            {
                url: request.url,
                method: request.method || 'GET',
                body: request.body ?? null,
                headers: filteredHeaders,
                referrer: request.referrer ?? null,
            }
        );

        return result;
    } finally {
        await page.close().catch(() => undefined);
        await context.close().catch(() => undefined);
    }
}
