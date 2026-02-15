/**
 * Client-side Dijidemi token manager.
 * 
 * Manages the authentication token that is:
 * 1. Fetched from Supabase via /api/auth/dijidemi-token on login
 * 2. Stored in localStorage as 'dijidemi_token'
 * 3. Sent as 'x-dijidemi-token' header on every API request
 * 
 * This replaces the browser cookie approach that fails on Netlify.
 */

const TOKEN_KEY = 'dijidemi_token';
const TOKEN_TIMESTAMP_KEY = 'dijidemi_token_ts';

/**
 * Fetch a fresh token from server and store in localStorage.
 * Should be called on login and periodically to refresh.
 */
export async function fetchAndStoreToken(): Promise<boolean> {
    try {
        const res = await fetch('/api/auth/dijidemi-token');
        const data = await res.json();

        if (!res.ok || !data.success || !data.token) {
            console.error('[TokenManager] Failed to fetch token:', data.error);
            return false;
        }

        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(TOKEN_TIMESTAMP_KEY, Date.now().toString());
        return true;
    } catch (err) {
        console.error('[TokenManager] Error fetching token:', err);
        return false;
    }
}

/**
 * Get the stored token from localStorage.
 */
export function getStoredToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
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
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_TIMESTAMP_KEY);
}

/**
 * Create headers object with the dijidemi token included.
 * Use this for all fetch() calls to our API.
 */
export function getAuthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...extraHeaders,
    };

    const token = getStoredToken();
    if (token) {
        headers['x-dijidemi-token'] = token;
    }

    const userId = typeof window !== 'undefined' ? localStorage.getItem('user_uuid') : null;
    if (userId) {
        headers['x-user-id'] = userId;
    }

    return headers;
}

/**
 * Wrapper around fetch that automatically adds auth headers.
 * Drop-in replacement for window.fetch for API calls.
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const token = getStoredToken();
    const userId = typeof window !== 'undefined' ? localStorage.getItem('user_uuid') : null;

    const headers = new Headers(options.headers);

    if (token) {
        headers.set('x-dijidemi-token', token);
    }
    if (userId) {
        headers.set('x-user-id', userId);
    }
    // Ensure Content-Type is set if not already
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
        headers.set('Content-Type', 'application/json');
    }

    return fetch(url, {
        ...options,
        headers,
    });
}
