import { supabase } from '@/lib/db/supabase';

export const PRIVATE_TEST_DEVICE_COOKIE = 'pt_device';
export const PRIVATE_TEST_UID_COOKIE = 'pt_uid';
export const PRIVATE_TEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5; // 5 years, refreshed on success

type GateStatus = 'ok' | 'enrolled' | 'unauthorized' | 'forbidden' | 'misconfigured' | 'error';

interface BrowserSignature {
    name: string;
    major: number;
}

interface VerifyOrEnrollBindingParams {
    userId: string;
    userAgent: string;
    deviceToken?: string | null;
    autoEnroll: boolean;
}

interface EnrollmentControlRow {
    is_open: boolean;
    enrollment_until: string | null;
}

interface BindingRow {
    id: number;
    token_hash: string;
    browser_name: string;
    browser_major: number;
}

export interface VerifyOrEnrollBindingResult {
    status: GateStatus;
    reason: string;
    cookieToken?: string;
}

export interface EnrollmentState {
    status: 'ok' | 'misconfigured' | 'error';
    isOpen: boolean;
    enrollmentUntil: string | null;
}

const encoder = new TextEncoder();

function getPrivateTestSecret(): string | null {
    const secret = process.env.PRIVATE_TEST_SECRET?.trim();
    if (!secret) return null;
    return secret;
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64url');
    }

    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i += 1) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return toHex(new Uint8Array(signature));
}

export function parseBrowserSignature(userAgent: string): BrowserSignature {
    if (!userAgent) {
        return { name: 'Unknown', major: 0 };
    }

    const candidates: Array<{ name: string; regex: RegExp }> = [
        { name: 'Edge', regex: /Edg\/(\d+)/i },
        { name: 'Opera', regex: /(?:OPR|Opera)\/(\d+)/i },
        { name: 'Chrome', regex: /Chrome\/(\d+)/i },
        { name: 'Firefox', regex: /Firefox\/(\d+)/i },
        { name: 'Safari', regex: /Version\/(\d+).+Safari/i },
    ];

    for (const candidate of candidates) {
        const match = userAgent.match(candidate.regex);
        if (!match) continue;
        const major = Number.parseInt(match[1], 10);
        return { name: candidate.name, major: Number.isFinite(major) ? major : 0 };
    }

    return { name: 'Unknown', major: 0 };
}

export function generateDeviceToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return toBase64Url(bytes);
}

export async function hashDeviceToken(rawToken: string): Promise<string | null> {
    if (!rawToken) return null;
    const secret = getPrivateTestSecret();
    if (!secret) return null;
    return hmacHex(secret, `pt_device:${rawToken}`);
}

export async function signUserId(userId: string): Promise<string | null> {
    if (!userId) return null;
    const secret = getPrivateTestSecret();
    if (!secret) return null;

    const signature = await hmacHex(secret, `pt_uid:${userId}`);
    return `${userId}.${signature}`;
}

export async function verifySignedUserId(signedValue: string | undefined | null): Promise<string | null> {
    if (!signedValue) return null;
    const secret = getPrivateTestSecret();
    if (!secret) return null;

    const separator = signedValue.lastIndexOf('.');
    if (separator <= 0) return null;

    const userId = signedValue.slice(0, separator);
    const sentSignature = signedValue.slice(separator + 1);
    if (!userId || !sentSignature) return null;

    const expectedSignature = await hmacHex(secret, `pt_uid:${userId}`);
    if (!timingSafeEqual(sentSignature, expectedSignature)) return null;
    return userId;
}

export async function verifyOrEnrollBinding(params: VerifyOrEnrollBindingParams): Promise<VerifyOrEnrollBindingResult> {
    const { userId, userAgent, deviceToken, autoEnroll } = params;

    if (!userId) {
        return { status: 'unauthorized', reason: 'missing_user' };
    }

    if (!getPrivateTestSecret()) {
        return { status: 'misconfigured', reason: 'missing_private_test_secret' };
    }

    const browser = parseBrowserSignature(userAgent);

    const { data: binding, error: lookupError } = await supabase
        .from('private_test_device_bindings')
        .select('id, token_hash, browser_name, browser_major')
        .eq('user_id', userId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<BindingRow>();

    if (lookupError) {
        console.error('[PrivateTestGate] binding lookup failed:', lookupError);
        return { status: 'error', reason: 'binding_lookup_failed' };
    }

    if (!binding) {
        if (!autoEnroll) {
            return { status: 'unauthorized', reason: 'binding_not_found' };
        }

        const freshToken = generateDeviceToken();
        const tokenHash = await hashDeviceToken(freshToken);
        if (!tokenHash) {
            return { status: 'misconfigured', reason: 'missing_private_test_secret' };
        }

        const now = new Date().toISOString();
        const { error: insertError } = await supabase.from('private_test_device_bindings').insert({
            user_id: userId,
            token_hash: tokenHash,
            browser_name: browser.name,
            browser_major: browser.major,
            user_agent: userAgent || null,
            created_at: now,
            last_seen_at: now,
        });

        if (insertError) {
            console.error('[PrivateTestGate] binding enrollment failed:', insertError);
            return { status: 'forbidden', reason: 'binding_enrollment_failed' };
        }

        return { status: 'enrolled', reason: 'binding_enrolled', cookieToken: freshToken };
    }

    if (!deviceToken) {
        return { status: 'forbidden', reason: 'missing_device_cookie' };
    }

    const presentedHash = await hashDeviceToken(deviceToken);
    if (!presentedHash) {
        return { status: 'misconfigured', reason: 'missing_private_test_secret' };
    }

    if (!timingSafeEqual(binding.token_hash, presentedHash)) {
        return { status: 'forbidden', reason: 'device_cookie_mismatch' };
    }

    const browserMatches = binding.browser_name === browser.name && binding.browser_major === browser.major;
    if (!browserMatches) {
        return { status: 'forbidden', reason: 'browser_signature_mismatch' };
    }

    const { error: touchError } = await supabase
        .from('private_test_device_bindings')
        .update({
            last_seen_at: new Date().toISOString(),
            user_agent: userAgent || null,
        })
        .eq('id', binding.id);

    if (touchError) {
        console.warn('[PrivateTestGate] last_seen update failed:', touchError);
    }

    return { status: 'ok', reason: 'binding_verified', cookieToken: deviceToken };
}

export async function getPrivateTestEnrollmentState(): Promise<EnrollmentState> {
    if (!getPrivateTestSecret()) {
        return {
            status: 'misconfigured',
            isOpen: false,
            enrollmentUntil: null,
        };
    }

    const { data, error } = await supabase
        .from('private_test_enrollment_control')
        .select('is_open, enrollment_until')
        .eq('id', 1)
        .maybeSingle<EnrollmentControlRow>();

    if (error) {
        console.error('[PrivateTestGate] enrollment control lookup failed:', error);
        return {
            status: 'error',
            isOpen: false,
            enrollmentUntil: null,
        };
    }

    if (!data) {
        return {
            status: 'ok',
            isOpen: false,
            enrollmentUntil: null,
        };
    }

    const now = Date.now();
    const until = data.enrollment_until ? new Date(data.enrollment_until).getTime() : null;
    const stillInWindow = until === null || until >= now;
    return {
        status: 'ok',
        isOpen: data.is_open && stillInWindow,
        enrollmentUntil: data.enrollment_until,
    };
}
