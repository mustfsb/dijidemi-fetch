import { supabase } from '@/lib/db/supabase';

interface RateLimitRpcRow {
    allowed?: boolean;
}

function normalizeKey(key: string): string {
    const value = (key || 'unknown').trim() || 'unknown';
    return value.slice(0, 256);
}

function toWindowSeconds(windowMs: number): number {
    return Math.max(1, Math.ceil(windowMs / 1000));
}

/**
 * Shared Postgres-backed rate limiter for serverless deployments.
 * @param key - Unique identifier (usually IP or IP+route)
 * @param limit - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds (default: 60 seconds)
 * @returns true if request is allowed, false if rate limited
 */
export async function checkRateLimit(key: string, limit: number = 30, windowMs: number = 60000): Promise<boolean> {
    const normalizedKey = normalizeKey(key);

    try {
        const { data, error } = await supabase.rpc('consume_rate_limit', {
            p_key: normalizedKey,
            p_limit: limit,
            p_window_seconds: toWindowSeconds(windowMs),
        });

        if (error) {
            console.error('[RateLimit] RPC failed:', error);
            return true;
        }

        const row = (Array.isArray(data) ? data[0] : data) as RateLimitRpcRow | null;
        if (!row || typeof row.allowed !== 'boolean') {
            console.warn('[RateLimit] RPC returned unexpected payload.');
            return true;
        }

        return row.allowed;
    } catch (error) {
        console.error('[RateLimit] Unexpected limiter failure:', error);
        return true;
    }
}

/**
 * Pre-configured rate limit profiles for different route types.
 */
export const RateLimits = {
    /** Login endpoints: 10 attempts per minute */
    LOGIN: (ip: string, scope?: string) => checkRateLimit(`login:${ip}:${normalizeKey(scope || 'anon')}`, 10, 60000),
    /** AI endpoints: 20 requests per minute (costly) */
    AI: (ip: string, scope?: string) => checkRateLimit(`ai:${ip}:${normalizeKey(scope || 'anon')}`, 20, 60000),
    /** General API: 60 requests per minute */
    GENERAL: (ip: string, scope?: string) => checkRateLimit(`general:${ip}:${normalizeKey(scope || 'anon')}`, 60, 60000),
    /** Heavy operations (Playwright, etc.): 3 per 5 minutes */
    HEAVY: (ip: string, scope?: string) => checkRateLimit(`heavy:${ip}:${normalizeKey(scope || 'anon')}`, 3, 300000),
} as const;
