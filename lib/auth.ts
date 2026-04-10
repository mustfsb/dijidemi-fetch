import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { PRIVATE_TEST_UID_COOKIE, verifySignedUserIdResult } from '@/lib/private-test/device-gate';
import {
    isLocalBrowserMode as isLocalBrowserEnvironmentMode,
    localDijidemiBrowserManager,
} from '@/lib/dijidemi/localBrowserManager';

interface SessionTokenPayload {
    uid: string;
    iat: number;
    exp: number;
}

const SESSION_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour
const MAX_USER_ID_LENGTH = 128;
export const DIJIDEMI_SESSION_COOKIE = 'dijidemi_session';
export const DIJIDEMI_UPSTREAM_COOKIE_NAMES = ['cf_clearance', 'ASP.NET_SessionId', 'usrtkn', '.ASPXAUTH'] as const;

type DijidemiUpstreamCookieName = (typeof DIJIDEMI_UPSTREAM_COOKIE_NAMES)[number];

type DijidemiUpstreamCookieMap = Partial<Record<DijidemiUpstreamCookieName, string>>;

const DIJIDEMI_UPSTREAM_BASE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
    Host: 'www.dijidemi.com',
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
});

interface DijidemiUpstreamHeaderOptions {
    additionalCookies?: Record<string, string | number | null | undefined>;
    additionalHeaders?: Record<string, string>;
    requireSession?: boolean;
}

interface DijidemiChallengeProbe {
    body: string;
    blocked: boolean;
}

function getSigningSecret(): string | null {
    const tokenSecret = process.env.DIJIDEMI_TOKEN_SECRET?.trim();
    const fallbackSecret = process.env.PRIVATE_TEST_SECRET?.trim();
    return tokenSecret || fallbackSecret || null;
}

function toHexHmac(secret: string, payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeHexEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
        return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
        return false;
    }
}

function parseSessionToken(token: string): SessionTokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [encodedPayload, signature] = parts;
    if (!encodedPayload || !signature) return null;

    const secret = getSigningSecret();
    if (!secret) return null;

    const expectedSignature = toHexHmac(secret, encodedPayload);
    if (!safeHexEquals(signature, expectedSignature)) {
        return null;
    }

    try {
        const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
        const payload = JSON.parse(payloadJson) as SessionTokenPayload;
        if (!payload || typeof payload !== 'object') return null;
        if (!payload.uid) return null;
        if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
        return payload;
    } catch {
        return null;
    }
}

function verifySessionToken(token: string, expectedUserId: string): boolean {
    const payload = parseSessionToken(token);
    if (!payload) return false;
    if (payload.uid !== expectedUserId) return false;
    if (payload.exp <= Date.now()) return false;
    return true;
}

export function createSignedSessionToken(payload: { userId: string }): string | null {
    const secret = getSigningSecret();
    if (!secret) return null;

    const userId = payload.userId.trim();
    if (!userId || userId.length > MAX_USER_ID_LENGTH) return null;

    const now = Date.now();
    const tokenPayload: SessionTokenPayload = {
        uid: userId,
        iat: now,
        exp: now + SESSION_TOKEN_TTL_MS,
    };

    const encodedPayload = Buffer.from(JSON.stringify(tokenPayload), 'utf8').toString('base64url');
    const signature = toHexHmac(secret, encodedPayload);
    return `${encodedPayload}.${signature}`;
}

function normalizeCookieValue(value: string | number | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
}

function decodeCookieHeaderValue(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function collectDijidemiUpstreamCookies(request: NextRequest): DijidemiUpstreamCookieMap {
    return DIJIDEMI_UPSTREAM_COOKIE_NAMES.reduce<DijidemiUpstreamCookieMap>((cookies, name) => {
        const value = request.cookies.get(name)?.value?.trim();
        if (value) {
            cookies[name] = decodeCookieHeaderValue(value);
        }
        return cookies;
    }, {});
}

function buildCookieHeader(cookies: Record<string, string>): string {
    return Object.entries(cookies)
        .filter(([, value]) => Boolean(value))
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
}

export function hasDijidemiUpstreamSession(request: NextRequest): boolean {
    const cookies = collectDijidemiUpstreamCookies(request);
    return Boolean(cookies.cf_clearance && cookies['ASP.NET_SessionId']);
}

export function isLocalBrowserMode(): boolean {
    return isLocalBrowserEnvironmentMode();
}

export function createMissingDijidemiSessionResponse(): NextResponse<{ error: string }> {
    return NextResponse.json(
        { error: 'Dijidemi oturumu bulunamadı. Lütfen tekrar giriş yapın.' },
        { status: 401 }
    );
}

export function getDijidemiUpstreamHeaders(
    request: NextRequest,
    options: DijidemiUpstreamHeaderOptions = {}
): Record<string, string> | null {
    const cookies = collectDijidemiUpstreamCookies(request) as Record<string, string>;

    if ((options.requireSession ?? true) && (!cookies.cf_clearance || !cookies['ASP.NET_SessionId'])) {
        return null;
    }

    for (const [name, rawValue] of Object.entries(options.additionalCookies || {})) {
        const value = normalizeCookieValue(rawValue);
        if (value) {
            cookies[name] = value;
        }
    }

    const cookieHeader = buildCookieHeader(cookies);
    return {
        ...DIJIDEMI_UPSTREAM_BASE_HEADERS,
        ...options.additionalHeaders,
        Cookie: cookieHeader,
    };
}

export function setDijidemiUpstreamCookies(response: NextResponse, cookies: Record<string, string>): void {
    for (const name of DIJIDEMI_UPSTREAM_COOKIE_NAMES) {
        const value = normalizeCookieValue(cookies[name]);
        if (!value) continue;

        response.cookies.set(name, value, {
            httpOnly: true,
            path: '/',
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
        });
    }
}

export function setDijidemiSessionCookie(response: NextResponse, userId: string): boolean {
    const token = createSignedSessionToken({ userId });
    if (!token) {
        return false;
    }

    response.cookies.set(DIJIDEMI_SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60,
    });

    return true;
}

function isDijidemiChallengeBody(body: string): boolean {
    const normalized = body.toLowerCase();
    return (
        normalized.includes('just a moment')
        || normalized.includes('bir dakika lütfen')
        || normalized.includes('enable javascript and cookies to continue')
        || normalized.includes('güvenlik doğrulaması gerçekleştirme')
    );
}

export async function probeDijidemiChallenge(response: Response): Promise<DijidemiChallengeProbe> {
    const body = await response.clone().text().catch(() => '');
    return {
        body,
        blocked: response.status === 403 && isDijidemiChallengeBody(body),
    };
}

export function createDijidemiChallengeResponse(): NextResponse<{ error: string }> {
    return NextResponse.json(
        { error: 'Dijidemi isteği Cloudflare koruması tarafından engellendi. Lütfen daha sonra tekrar deneyin.' },
        { status: 503 }
    );
}

export async function getDijidemiSessionHealth(request: NextRequest, userId: string): Promise<'valid' | 'awaiting_verification' | 'missing_upstream_session' | 'error'> {
    if (isLocalBrowserMode()) {
        return localDijidemiBrowserManager.getHealthForUserId(userId);
    }

    return hasDijidemiUpstreamSession(request) ? 'valid' : 'missing_upstream_session';
}

export async function requireUserIdentity(request: NextRequest): Promise<{ userId: string } | NextResponse> {
    const secret = getSigningSecret();
    if (!secret) {
        return NextResponse.json(
            { error: 'Sunucu kimlik doğrulama ayarı eksik.' },
            { status: 500 }
        );
    }

    const verification = await verifySignedUserIdResult(request.cookies.get(PRIVATE_TEST_UID_COOKIE)?.value);
    if (verification.error) {
        return NextResponse.json(
            { error: 'Oturum doğrulama altyapısı kullanılamıyor. Lütfen daha sonra tekrar deneyin.' },
            { status: 500 }
        );
    }

    if (!verification.userId) {
        return NextResponse.json(
            { error: 'Oturum kimliği doğrulanamadı. Lütfen tekrar giriş yapın.' },
            { status: 401 }
        );
    }

    return { userId: verification.userId };
}

/**
 * API auth guard:
 * 1) Requires a server-signed user identity cookie
 * 2) Accepts a valid signed session token from `dijidemi_session` or the temporary header bridge
 */
export async function requireAuth(request: NextRequest): Promise<{ userId: string } | NextResponse> {
    const identity = await requireUserIdentity(request);
    if (identity instanceof NextResponse) return identity;

    const headerToken = request.headers.get('x-dijidemi-token')?.trim() || null;
    const cookieToken = request.cookies.get(DIJIDEMI_SESSION_COOKIE)?.value?.trim() || null;
    const sessionToken = headerToken || cookieToken;

    if (!sessionToken) {
        return NextResponse.json(
            { error: 'Oturum açmanız gerekiyor.' },
            { status: 401 }
        );
    }

    if (verifySessionToken(sessionToken, identity.userId)) {
        return identity;
    }

    return NextResponse.json(
        { error: 'Geçersiz veya süresi dolmuş oturum tokeni.' },
        { status: 401 }
    );
}

function isValidIp(ip: string | null): ip is string {
    if (!ip) return false;
    const value = ip.trim();
    if (!value) return false;
    // Basic IPv4/IPv6 format check to reject arbitrary header strings.
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[a-fA-F0-9:]+$/.test(value);
}

/**
 * Extract client IP from trusted proxy headers.
 */
export function getClientIp(request: NextRequest): string {
    const platformIp = request.headers.get('x-nf-client-connection-ip');
    if (isValidIp(platformIp)) {
        return platformIp.trim();
    }

    return 'unknown';
}
