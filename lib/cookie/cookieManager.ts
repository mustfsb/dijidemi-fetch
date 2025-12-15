import { CookieRecord, HeaderRecord } from '@/types';
import { playwrightService } from './playwrightService';
import { supabase } from '@/lib/db/supabase';
import fs from 'fs';
import path from 'path';

class CookieManager {
    private cookies: CookieRecord;
    private baseHeaders: HeaderRecord;
    private isRefreshing: boolean = false;
    private refreshPromise: Promise<void> | null = null;
    private lastDbCheck: number = 0;
    private readonly DB_CHECK_INTERVAL = 1000 * 60 * 5; // Check DB every 5 mins for updates from other instances

    constructor() {
        // Initial empty state, will be populated async
        this.cookies = {
            'cf_clearance': '',
            'ASP.NET_SessionId': '',
            'usrtkn': ''
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
                this.cookies = { ...this.cookies, ...parsed };
                return true;
            }
        } catch (err) {
            console.error('Unexpected error loading cookies:', err);
        }
        return false;
    }

    private async saveToSupabase(cookies: CookieRecord) {
        try {
            console.log('Saving cookies to Supabase...');
            // Upsert into auth_cookies with a fixed ID to ensure singleton-like behavior
            const { error } = await supabase
                .from('auth_cookies')
                .upsert({
                    id: 1,
                    cookie_json: cookies,
                    updated_at: new Date().toISOString()
                });

            if (error) {
                console.error('Error saving cookies to Supabase:', JSON.stringify(error, null, 2));
                // Add hint about RLS/Keys
                if (error.code === '42501') {
                    console.error('Hint: Check if SUPABASE_SERVICE_ROLE_KEY is set in Netlify Environment Variables and if RLS policies allow the write.');
                }
            } else {
                console.log('Successfully saved to Supabase.');
            }

            // Also save to local file (simulating "local storage" persistence on server)
            try {
                // In Lambda/Netlify, only /tmp is writable
                const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_VERSION || !!process.env.NETLIFY || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
                const dir = isLambda ? '/tmp' : path.join(process.cwd(), 'lib/cookie');

                // Ensure dir exists locally
                if (!isLambda && !fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                const filePath = path.join(dir, 'cookies.json');
                fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
                console.log(`Saved backup copy to ${filePath}`);
            } catch (localError) {
                // Ignore local write errors in production/serverless if read-only
                console.warn('Could not save to local cookies.json:', localError);
            }

        } catch (err) {
            console.error('Unexpected error saving cookies:', err);
        }
    }

    private async ensureValidCookies(force: boolean = false): Promise<void> {
        // 1. Check if we have valid cookies in memory
        const hasInMemoryCookies = this.cookies['cf_clearance'] && this.cookies['ASP.NET_SessionId'];

        // 2. If not, or if it's been a while, try to load from DB first
        const timeSinceLastDbCheck = Date.now() - this.lastDbCheck;

        if (!hasInMemoryCookies || timeSinceLastDbCheck > this.DB_CHECK_INTERVAL) {
            await this.loadFromSupabase();
            this.lastDbCheck = Date.now();
        }

        const hasCookies = this.cookies['cf_clearance'] && this.cookies['ASP.NET_SessionId'];

        if (hasCookies && !force) {
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
                console.log('Refreshing cookies via Playwright...');
                const newCookies = await playwrightService.getFreshCookies();

                // usrtkn often matches ASP.NET_SessionId with a prefix
                if (newCookies['ASP.NET_SessionId'] && !newCookies['usrtkn']) {
                    newCookies['usrtkn'] = `tkn=${newCookies['ASP.NET_SessionId']}`;
                }

                this.cookies = { ...this.cookies, ...newCookies };
                await this.saveToSupabase(this.cookies);
                console.log('Cookies refreshed and saved to Supabase.');
            } catch (error) {
                console.error('Failed to refresh cookies:', error);
            } finally {
                this.isRefreshing = false;
                this.refreshPromise = null;
            }
        })();

        await this.refreshPromise;
    }

    async getHeaders(): Promise<HeaderRecord> {
        await this.ensureValidCookies(false);
        return {
            ...this.baseHeaders,
            "Cookie": this.getCookieString()
        };
    }

    // Called by Cron Job
    async refreshCookies(): Promise<void> {
        await this.ensureValidCookies(true);
    }
}

const cookieManager = new CookieManager();
export default cookieManager;
