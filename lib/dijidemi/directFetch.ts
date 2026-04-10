/**
 * Direct HTTP fetch to dijidemi.com — no browser involved.
 *
 * Uses the mobile app User-Agent (DijidemiMobile/CFNetwork) which is not subject
 * to Cloudflare's browser-challenge flow. Requests must carry a valid cf_clearance
 * cookie (obtained from a real browser via `npm run seed-cookies`).
 */

const MOBILE_UA = 'DijidemiMobile/41 CFNetwork/3860.300.31 Darwin/25.2.0';
const WANTED_COOKIES = new Set(['cf_clearance', 'ASP.NET_SessionId', 'usrtkn', '.ASPXAUTH']);

function buildCookieString(cookies: Array<{ name: string; value: string }>): string {
    return cookies.filter(c => c.value).map(c => `${c.name}=${c.value}`).join('; ');
}

/**
 * Parse all Set-Cookie headers from a response, returning a map of
 * { cookieName: cookieValue } for the cookies we care about.
 */
function parseSetCookies(response: Response): Record<string, string> {
    const result: Record<string, string> = {};

    // Node.js 18+ undici supports getSetCookie() returning string[]
    const rawHeaders: string[] =
        (typeof (response.headers as any).getSetCookie === 'function'
            ? (response.headers as any).getSetCookie()
            : null)
        ?? [response.headers.get('set-cookie') ?? ''].filter(Boolean);

    for (const header of rawHeaders) {
        const nameValuePart = header.split(';')[0]?.trim() ?? '';
        const eqIndex = nameValuePart.indexOf('=');
        if (eqIndex <= 0) continue;
        const name = nameValuePart.slice(0, eqIndex).trim();
        const value = nameValuePart.slice(eqIndex + 1).trim();
        if (WANTED_COOKIES.has(name) && value) result[name] = value;
    }

    return result;
}

export interface DirectFetchResult {
    status: number;
    body: string;
    ok: boolean;
    isCloudflareChallenge: boolean;
}

function isChallengeBody(body: string): boolean {
    const n = body.toLowerCase();
    return (
        n.includes('just a moment')
        || n.includes('bir dakika lütfen')
        || n.includes('enable javascript and cookies to continue')
        || n.includes('güvenlik doğrulaması gerçekleştirme')
    );
}

/**
 * Make a single HTTP request to dijidemi.com with the mobile UA and stored cookies.
 */
export async function directFetchDijidemi(
    url: string,
    options: {
        method?: 'GET' | 'POST';
        headers?: Record<string, string>;
        body?: string;
        cookies: Array<{ name: string; value: string }>;
        referrer?: string;
    }
): Promise<DirectFetchResult> {
    const cookieString = buildCookieString(options.cookies);
    const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
            'User-Agent': MOBILE_UA,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cookie': cookieString,
            ...(options.referrer ? { 'Referer': options.referrer } : {}),
            ...(options.headers ?? {}),
        },
        body: options.body,
        redirect: 'follow',
    });

    const body = await response.text();
    const challenge = isChallengeBody(body);
    return { status: response.status, body, ok: response.ok && !challenge, isCloudflareChallenge: challenge };
}

export interface DirectLoginResult {
    success: boolean;
    /** Merged cookie set (existing + new from Set-Cookie) for the wanted names. */
    cookies: Record<string, string>;
    error?: string;
}

/**
 * Attempt a login to dijidemi.com via a direct HTTP POST (no browser).
 *
 * Steps:
 * 1. GET /login to obtain a fresh ASP.NET session (and possibly CSRF token).
 * 2. POST /Login/UserLogin with credentials.
 * 3. Parse Set-Cookie from the response.
 *
 * Returns the full cookie set (cf_clearance from existingCookies + new session cookies).
 */
export async function directLoginDijidemi(
    username: string,
    password: string,
    existingCookies: Array<{ name: string; value: string }>
): Promise<DirectLoginResult> {
    let cookieString = buildCookieString(existingCookies);
    const accumulatedCookies: Record<string, string> = {};

    // Step 1: GET the login page — obtains a fresh ASP.NET_SessionId and any hidden tokens
    const getResponse = await fetch('https://www.dijidemi.com/login', {
        method: 'GET',
        headers: {
            'User-Agent': MOBILE_UA,
            'Accept': 'text/html,application/xhtml+xml,*/*',
            'Accept-Language': 'tr-TR,tr;q=0.9',
            'Cookie': cookieString,
        },
        redirect: 'follow',
    });

    const getBody = await getResponse.text();

    if (isChallengeBody(getBody)) {
        return {
            success: false,
            cookies: {},
            error: 'Cloudflare challenge aşılamadı. cf_clearance geçersiz veya süresi dolmuş. npm run seed-cookies çalıştırın.',
        };
    }

    // Absorb any cookies set during the GET
    Object.assign(accumulatedCookies, parseSetCookies(getResponse));

    // Extract verification token if present (ASP.NET anti-forgery)
    let verificationToken = '';
    const tokenMatch = getBody.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i)
        ?? getBody.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/i);
    if (tokenMatch) verificationToken = tokenMatch[1];

    // Rebuild cookie string with any new session cookies from the GET
    const mergedForPost = buildCookieString([
        ...existingCookies,
        ...Object.entries(accumulatedCookies).map(([name, value]) => ({ name, value })),
    ]);

    // Step 2: POST credentials
    const postBody = new URLSearchParams({ UserName: username, Password: password });
    if (verificationToken) postBody.set('__RequestVerificationToken', verificationToken);

    const postResponse = await fetch('https://www.dijidemi.com/Login/UserLogin', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': MOBILE_UA,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'tr-TR,tr;q=0.9',
            'Cookie': mergedForPost,
            'Referer': 'https://www.dijidemi.com/login',
        },
        body: postBody.toString(),
        redirect: 'manual', // capture Set-Cookie from redirect
    });

    const postBody2 = await postResponse.text();

    // Check for Cloudflare challenge
    if (isChallengeBody(postBody2)) {
        return {
            success: false,
            cookies: {},
            error: 'Cloudflare challenge aşılamadı. cf_clearance geçersiz veya süresi dolmuş.',
        };
    }

    // Absorb new cookies from the POST response
    Object.assign(accumulatedCookies, parseSetCookies(postResponse));

    // Determine success
    const status = postResponse.status;
    let succeeded = false;

    if (status === 302 || status === 301) {
        // Redirect → logged in
        succeeded = true;
    } else if (status === 401) {
        return { success: false, cookies: {}, error: 'Kullanıcı adı veya şifre hatalı.' };
    } else if (status >= 400) {
        return { success: false, cookies: {}, error: `Dijidemi login hatası: ${status}` };
    } else {
        // Parse JSON body
        try {
            const json = JSON.parse(postBody2) as Record<string, unknown>;
            const ok = json.Success ?? json.success;
            if (ok === false) {
                const msg = (json.Message ?? json.message ?? 'Kullanıcı adı veya şifre hatalı.') as string;
                return { success: false, cookies: {}, error: msg };
            }
            succeeded = true;
        } catch {
            // Not JSON — treat 200 as success
            if (status === 200) succeeded = true;
        }
    }

    if (!succeeded) {
        return { success: false, cookies: {}, error: `Beklenmeyen login yanıtı: ${status}` };
    }

    // Merge: existing cookies + new session cookies
    const finalCookies: Record<string, string> = {};
    for (const c of existingCookies) {
        if (WANTED_COOKIES.has(c.name) && c.value) finalCookies[c.name] = c.value;
    }
    Object.assign(finalCookies, accumulatedCookies);

    if (finalCookies['ASP.NET_SessionId'] && !finalCookies['usrtkn']) {
        finalCookies['usrtkn'] = `tkn=${finalCookies['ASP.NET_SessionId']}`;
    }

    return { success: true, cookies: finalCookies };
}
