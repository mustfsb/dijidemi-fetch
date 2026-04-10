import { CookieRecord, HeaderRecord } from '@/types';
import { supabase } from '@/lib/db/supabase';

// This singleton owns the shared automation Dijidemi session stored in auth_cookies.
// It is safe for server-side upstream fetches only and must never be used for per-user authorization.
class CookieManager {
    private cookies: CookieRecord;
    private baseHeaders: HeaderRecord;
    private isRefreshing: boolean = false;
    private refreshPromise: Promise<void> | null = null;
    private lastDbCheck: number = 0;
    private lastCookieUpdateAt: number = 0;
    private readonly DB_CHECK_INTERVAL = 1000 * 60 * 5; // Check DB every 5 mins for updates from other instances
    private readonly SHARED_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 6; // Avoid expensive hourly Playwright refreshes when cookies are still recent

    // Cached headers to avoid redundant Supabase reads on rapid successive calls
    private cachedHeaders: HeaderRecord | null = null;
    private cachedHeadersTimestamp: number = 0;
    private readonly HEADERS_CACHE_TTL = 1000 * 30; // 30 seconds

    constructor() {
        // Initial empty state, will be populated async
        this.cookies = {
            'cf_clearance': '',
            'ASP.NET_SessionId': '',
            'usrtkn': '',
            '.ASPXAUTH': '',
        };

        this.baseHeaders = {
            "Host": "www.dijidemi.com",
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "DijidemiMobile/41 CFNetwork/3860.300.31 Darwin/25.2.0",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive"
        };
    }

    getCookieString(): string {
        return Object.entries(this.cookies)
            .filter(([_, value]) => value) // Filter out empty values
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');
    }

    /**
     * Loads cookies from Supabase.
     * Returns true if cookies were found and loaded, false otherwise.
     */
    private async loadFromSupabase(): Promise<boolean> {
        try {
            const { data, error } = await supabase
                .from('auth_cookies')
                .select('*')
                .order('updated_at', { ascending: false })
                .limit(1)
                .single();

            if (error) {
                // It's okay if no rows exist yet or table is empty
                if (error.code !== 'PGRST116') { // PGRST116 is "JSON object requested, multiple (or no) rows returned" for single()
                    console.error('Error fetching cookies from Supabase:', error);
                }
                return false;
            }

            if (data && data.cookie_json) {
                const parsed = typeof data.cookie_json === 'string' ? JSON.parse(data.cookie_json) : data.cookie_json;
                
                // Handle the nested format {"cookies": {...}, "user_agent": "..."} from Python proxy
                const actualCookies = parsed.cookies ? parsed.cookies : parsed;
                
                this.cookies = { ...this.cookies, ...actualCookies };
                this.lastCookieUpdateAt = data.updated_at ? Date.parse(data.updated_at) || this.lastCookieUpdateAt : this.lastCookieUpdateAt;
                return true;
            }
        } catch (err) {
            console.error('Unexpected error loading cookies:', err);
        }
        return false;
    }

    private async saveToSupabase(cookies: CookieRecord) {
        try {
            console.log('Saving automation cookies to Supabase...');
            const updatedAt = new Date().toISOString();
            // Upsert into auth_cookies with a fixed ID to ensure singleton-like behavior
            const { error } = await supabase
                .from('auth_cookies')
                .upsert({
                    id: 1,
                    cookie_json: cookies,
                    updated_at: updatedAt
                });

            if (error) {
                console.error('Error saving cookies to Supabase:', JSON.stringify(error, null, 2));
                // Add hint about RLS/Keys
                if (error.code === '42501') {
                    console.error('Hint: Check if SUPABASE_SERVICE_ROLE_KEY is set in Netlify Environment Variables and if RLS policies allow the write.');
                }
            } else {
                this.lastCookieUpdateAt = Date.parse(updatedAt) || Date.now();
                console.log('Successfully saved automation cookies to Supabase. Keys:', Object.keys(cookies).sort());
            }

        } catch (err) {
            console.error('Unexpected error saving cookies:', err);
        }
    }

    private hasCriticalCookies(): boolean {
        return Boolean(this.cookies['cf_clearance'] && this.cookies['ASP.NET_SessionId']);
    }

    private shouldRefreshSharedCookies(force: boolean): boolean {
        if (!this.hasCriticalCookies()) {
            return true;
        }

        if (!force) {
            return false;
        }

        if (!this.lastCookieUpdateAt) {
            return true;
        }

        return (Date.now() - this.lastCookieUpdateAt) >= this.SHARED_REFRESH_INTERVAL_MS;
    }

    private async ensureValidCookies(force: boolean = false): Promise<void> {
        // 1. Check if we have valid cookies in memory
        const hasInMemoryCookies = this.hasCriticalCookies();

        // 2. If not, or if it's been a while, try to load from DB first
        const timeSinceLastDbCheck = Date.now() - this.lastDbCheck;

        if (!hasInMemoryCookies || timeSinceLastDbCheck > this.DB_CHECK_INTERVAL) {
            await this.loadFromSupabase();
            this.lastDbCheck = Date.now();
        }

        if (!this.shouldRefreshSharedCookies(force)) {
            if (force) {
                console.log('Shared automation cookies are still fresh; skipping forced refresh.');
            }
            return;
        }

        // Avoid multiple simultaneous refreshes
        if (this.isRefreshing) {
            if (this.refreshPromise) await this.refreshPromise;
            return;
        }

        this.isRefreshing = true;
        this.refreshPromise = (async () => {
            try {
                console.log('Refreshing cookies via Python Proxy (This will take 15-20 seconds to pass Cloudflare)...');
                const pythonApiUrl = process.env.DIJIDEMI_PYTHON_API_URL || "http://127.0.0.1:8000";
                
                // Set a longer timeout if fetch supports it, but node fetch doesn't natively expose timeout.
                // It will wait for the Python backend to finish the browser automation.
                const res = await fetch(`${pythonApiUrl}/api/refresh-cookies`, { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (!res.ok) {
                    throw new Error('Failed to start cookie refresh on proxy');
                }
                
                // Immediately after success, fetch from supabase to get the latest
                await this.loadFromSupabase();
                
                console.log('Automation cookies refresh completed. Keys:', Object.keys(this.cookies).sort());
            } catch (error) {
                console.error('Failed to refresh cookies:', error);
                throw error;
            } finally {
                this.isRefreshing = false;
                this.refreshPromise = null;
            }
        })();

        await this.refreshPromise;
    }

    async getHeaders(): Promise<HeaderRecord> {
        // Return cached headers if still fresh (avoids redundant Supabase reads on rapid calls)
        const now = Date.now();
        if (this.cachedHeaders && (now - this.cachedHeadersTimestamp) < this.HEADERS_CACHE_TTL) {
            return this.cachedHeaders;
        }

        await this.ensureValidCookies(false);
        const headers = {
            ...this.baseHeaders,
            "Cookie": this.getCookieString()
        };

        this.cachedHeaders = headers;
        this.cachedHeadersTimestamp = now;
        return headers;
    }

    async getCookies(): Promise<Array<{ name: string; value: string }>> {
        await this.ensureValidCookies(false);
        return Object.entries(this.cookies)
            .filter(([, value]) => Boolean(value))
            .map(([name, value]) => ({ name, value }));
    }

    // Called by Cron Job or on-demand to reload and refresh cookies
    async refreshCookies(): Promise<void> {
        this.cachedHeaders = null;
        this.lastCookieUpdateAt = 0; // Reset so shouldRefreshSharedCookies always returns true
        await this.ensureValidCookies(true);
    }
}

const cookieManager = new CookieManager();
export default cookieManager;
