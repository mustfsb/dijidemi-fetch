import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { PRIVATE_TEST_UID_COOKIE } from '@/lib/private-test/device-gate';

interface SessionTokenPayload {
    uid: string;
    s: string;
    c: string;
    u: string;
    iat: number;
    exp: number;
}

const SESSION_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour
const MAX_USER_ID_LENGTH = 128;

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

function parseSignedUserId(signedValue: string | undefined): string | null {
    if (!signedValue) return null;
    const secret = getSigningSecret();
    if (!secret) return null;

    const separator = signedValue.lastIndexOf('.');
    if (separator <= 0) return null;

    const userId = signedValue.slice(0, separator);
    const signature = signedValue.slice(separator + 1);

    if (!userId || !signature || userId.length > MAX_USER_ID_LENGTH) return null;
    const expectedSignature = toHexHmac(secret, `pt_uid:${userId}`);
    return safeHexEquals(signature, expectedSignature) ? userId : null;
}

function hasSessionCookie(request: NextRequest): boolean {
    return Boolean(
        request.cookies.get('.ASPXAUTH')?.value
        || request.cookies.get('ASP.NET_SessionId')?.value
    );
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
        if (!payload.uid || !payload.s) return null;
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

function isLegacyToken(token: string): boolean {
    if (token.includes('.')) return false;
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded) as { s?: unknown };
        return typeof parsed?.s === 'string' && parsed.s.length > 0;
    } catch {
        return false;
    }
}

export function createSignedSessionToken(payload: {
    userId: string;
    sessionId: string;
    cfClearance?: string;
    usrtkn?: string;
}): string | null {
    const secret = getSigningSecret();
    if (!secret) return null;

    const userId = payload.userId.trim();
    if (!userId || userId.length > MAX_USER_ID_LENGTH || !payload.sessionId) return null;

    const now = Date.now();
    const tokenPayload: SessionTokenPayload = {
        uid: userId,
        s: payload.sessionId,
        c: payload.cfClearance || '',
        u: payload.usrtkn || '',
        iat: now,
        exp: now + SESSION_TOKEN_TTL_MS,
    };

    const encodedPayload = Buffer.from(JSON.stringify(tokenPayload), 'utf8').toString('base64url');
    const signature = toHexHmac(secret, encodedPayload);
    return `${encodedPayload}.${signature}`;
}

export function requireUserIdentity(request: NextRequest): { userId: string } | NextResponse {
    const secret = getSigningSecret();
    if (!secret) {
        return NextResponse.json(
            { error: 'Sunucu kimlik doğrulama ayarı eksik.' },
            { status: 500 }
        );
    }

    const userId = parseSignedUserId(request.cookies.get(PRIVATE_TEST_UID_COOKIE)?.value);
    if (!userId) {
        return NextResponse.json(
            { error: 'Oturum kimliği doğrulanamadı. Lütfen tekrar giriş yapın.' },
            { status: 401 }
        );
    }

    return { userId };
}

/**
 * API auth guard:
 * 1) Requires a server-signed user identity cookie
 * 2) Accepts either a valid signed session token header or legacy session cookies
 */
export function requireAuth(request: NextRequest): { userId: string } | NextResponse {
    const identity = requireUserIdentity(request);
    if (identity instanceof NextResponse) return identity;

    const headerToken = request.headers.get('x-dijidemi-token')?.trim();
    const sessionCookiePresent = hasSessionCookie(request);

    if (headerToken) {
        if (verifySessionToken(headerToken, identity.userId)) {
            return identity;
        }

        // Compatibility path for older localStorage token format during rollout.
        if (sessionCookiePresent && isLegacyToken(headerToken)) {
            return identity;
        }

        return NextResponse.json(
            { error: 'Geçersiz veya süresi dolmuş oturum tokeni.' },
            { status: 401 }
        );
    }

    if (sessionCookiePresent) {
        return identity;
    }

    return NextResponse.json(
        { error: 'Oturum açmanız gerekiyor.' },
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
    const trustedHeaders = [
        request.headers.get('x-nf-client-connection-ip'),
        request.headers.get('cf-connecting-ip'),
        request.headers.get('x-real-ip'),
    ];

    for (const candidate of trustedHeaders) {
        if (isValidIp(candidate)) return candidate.trim();
    }

    const forwarded = request.headers.get('x-forwarded-for');
    const firstHop = forwarded?.split(',')[0]?.trim() || null;
    if (isValidIp(firstHop)) return firstHop;

    return 'unknown';
}
