/**
 * In-memory rate limiter for API routes.
 * Tracks request counts per IP within a sliding window.
 */

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        if (now > entry.resetAt) {
            store.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Check if a request is within the rate limit.
 * @param key - Unique identifier (usually IP or IP+route)
 * @param limit - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds (default: 60 seconds)
 * @returns true if request is allowed, false if rate limited
 */
export function checkRateLimit(key: string, limit: number = 30, windowMs: number = 60000): boolean {
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs });
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
    LOGIN: (ip: string) => checkRateLimit(`login:${ip}`, 10, 60000),
    /** AI endpoints: 20 requests per minute (costly) */
    AI: (ip: string) => checkRateLimit(`ai:${ip}`, 20, 60000),
    /** General API: 60 requests per minute */
    GENERAL: (ip: string) => checkRateLimit(`general:${ip}`, 60, 60000),
    /** Heavy operations (Playwright, etc.): 3 per 5 minutes */
    HEAVY: (ip: string) => checkRateLimit(`heavy:${ip}`, 3, 300000),
} as const;
