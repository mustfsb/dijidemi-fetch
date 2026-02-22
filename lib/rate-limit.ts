/**
 * In-memory rate limiter for API routes.
 * Tracks request counts per IP within a sliding window.
 */

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_ENTRIES = 10000;

// Clean up expired entries periodically (every 5 minutes)
const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        if (now > entry.resetAt) {
            store.delete(key);
        }
    }
}, 5 * 60 * 1000);
cleanupTimer.unref?.();

function normalizeKey(key: string): string {
    const value = (key || 'unknown').trim() || 'unknown';
    return value.slice(0, 256);
}

function enforceStoreBound(now: number): void {
    if (store.size < MAX_ENTRIES) return;

    // First pass: remove expired entries.
    for (const [key, entry] of store.entries()) {
        if (now > entry.resetAt) {
            store.delete(key);
        }
    }

    // Second pass: if still too large, evict oldest insertion-order entries.
    while (store.size >= MAX_ENTRIES) {
        const oldestKey = store.keys().next().value;
        if (!oldestKey) break;
        store.delete(oldestKey);
    }
}

/**
 * Check if a request is within the rate limit.
 * @param key - Unique identifier (usually IP or IP+route)
 * @param limit - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds (default: 60 seconds)
 * @returns true if request is allowed, false if rate limited
 */
export function checkRateLimit(key: string, limit: number = 30, windowMs: number = 60000): boolean {
    const now = Date.now();
    const normalizedKey = normalizeKey(key);
    const entry = store.get(normalizedKey);

    if (!entry || now > entry.resetAt) {
        enforceStoreBound(now);
        store.set(normalizedKey, { count: 1, resetAt: now + windowMs });
        return true;
    }

    entry.count++;
    return entry.count <= limit;
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
