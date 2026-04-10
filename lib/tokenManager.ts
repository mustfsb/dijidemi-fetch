/**
 * Client-side Dijidemi token manager.
 * 
 * Manages the authentication token that is:
 * 1. Refreshed via /api/auth/dijidemi-token on login
 * 2. Stored server-side as the httpOnly 'dijidemi_session' cookie
 * 3. Tracked locally only by refresh timestamp for proactive renewal
 *
 * User identity is server-derived from signed cookies; clients do not send user IDs.
 */

const TOKEN_TIMESTAMP_KEY = 'dijidemi_token_ts';

export function markTokenFresh(): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TOKEN_TIMESTAMP_KEY, Date.now().toString());
}

/**
 * Fetch a fresh token from server and refresh the httpOnly cookie.
 * Should be called on login and periodically to refresh.
 */
export async function fetchAndStoreToken(): Promise<boolean> {
    try {
        const res = await fetch('/api/auth/dijidemi-token', {
            credentials: 'same-origin',
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            console.error('[TokenManager] Failed to fetch token:', data.error);
            return false;
        }

        markTokenFresh();
        return true;
    } catch (err) {
        console.error('[TokenManager] Error fetching token:', err);
        return false;
    }
}

/**
 * Check if the token needs refresh (older than 1 hour).
 */
export function isTokenStale(): boolean {
    if (typeof window === 'undefined') return true;
    const ts = localStorage.getItem(TOKEN_TIMESTAMP_KEY);
    if (!ts) return true;
    const age = Date.now() - parseInt(ts, 10);
    const ONE_HOUR = 1000 * 60 * 60;
    return age > ONE_HOUR;
}

/**
 * Clear the stored token (on logout).
 */
export function clearStoredToken(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_TIMESTAMP_KEY);
}

/**
 * Wrapper around fetch that automatically sends same-origin auth cookies.
 * Drop-in replacement for window.fetch for same-origin API calls.
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);

    // Ensure Content-Type is set if not already
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
        headers.set('Content-Type', 'application/json');
    }

    return fetch(url, {
        ...options,
        credentials: 'same-origin',
        headers,
    });
}
