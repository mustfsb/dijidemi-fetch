import { randomUUID, createHash } from 'crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { supabase } from '@/lib/db/supabase';
import type { CookieData, DijidemiLoginCredentials } from '@/lib/cookie/playwrightService';

type PlaywrightModule = typeof import('playwright');
type BrowserContext = import('playwright').BrowserContext;
type Page = import('playwright').Page;

export type LocalLoginAttemptStatus =
    | 'opening_browser'
    | 'awaiting_verification'
    | 'ready'
    | 'failed';

export interface LocalLoginAttemptSnapshot {
    attemptId: string;
    username: string;
    status: LocalLoginAttemptStatus;
    message: string;
    error?: string;
}

export interface LocalBrowserFetchRequest {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    additionalCookies?: Record<string, string | number | null | undefined>;
    referrer?: string;
}

export interface LocalBrowserFetchResponse {
    status: number;
    url: string;
    headers: Record<string, string>;
    body: string;
}

type SessionStatus = 'launching' | 'awaiting_verification' | 'ready' | 'failed';

interface LocalBrowserSession {
    username: string;
    userDataDir: string;
    context: BrowserContext | null;
    page: Page | null;
    status: SessionStatus;
    lastValidatedAt: number;
    lastActivityAt: number;
    error?: string;
    launchPromise: Promise<BrowserContext> | null;
    requestQueue: Promise<void>;
}

interface LocalLoginAttempt {
    id: string;
    username: string;
    password: string;
    status: LocalLoginAttemptStatus;
    message: string;
    error?: string;
    createdAt: number;
}

interface PageSnapshot {
    url: string;
    title: string;
    bodyText: string;
    loginFormVisible: boolean;
    loginErrorText: string | null;
    challenge: boolean;
}

interface SessionResolutionReady {
    status: 'ready';
    session: LocalBrowserSession;
}

interface SessionResolutionPending {
    status: 'awaiting_verification' | 'failed' | 'missing';
    message: string;
}

type SessionResolution = SessionResolutionReady | SessionResolutionPending;

const LOGIN_URL = 'https://www.dijidemi.com/login';
const LMS_INDEX_URL = 'https://www.dijidemi.com/Lms/Index';
const SESSION_STALE_MS = 1000 * 60 * 2;
const LOGIN_WAIT_TIMEOUT_MS = 1000 * 60 * 5;
const POLL_INTERVAL_MS = 1500;
const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin' },
      { name: 'Chrome PDF Viewer' },
      { name: 'Native Client' },
    ],
  });
  window.chrome = window.chrome || { runtime: {} };
`;

const LOGIN_ERROR_SELECTORS = [
    '.validation-summary-errors',
    '.alert-danger',
    '.text-danger',
    '#lblError',
    '.login-error',
] as const;

const FORBIDDEN_BROWSER_HEADERS = new Set([
    'accept-encoding',
    'connection',
    'content-length',
    'cookie',
    'host',
    'origin',
    'priority',
    'referer',
    'user-agent',
]);

function isLocalBrowserEnvironment(): boolean {
    // DIJIDEMI_HEADLESS_LOGIN=true opts out of the visible-Chrome local mode,
    // using headless playwright (same as production) for login instead.
    if (process.env.DIJIDEMI_HEADLESS_LOGIN === 'true') return false;
    return process.env.NODE_ENV === 'development'
        && !process.env.NETLIFY
        && !process.env.AWS_LAMBDA_FUNCTION_NAME
        && !process.env.AWS_LAMBDA_FUNCTION_VERSION;
}

function ensureDirectory(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeUsername(username: string): string {
    const normalized = username.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    const hash = createHash('sha1').update(username).digest('hex').slice(0, 8);
    return `${normalized || 'user'}-${hash}`;
}

function findChromeExecutable(): string {
    const explicit = process.env.DIJIDEMI_LOCAL_CHROME_PATH?.trim();
    const candidates = [
        explicit,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
        path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error('Local Google Chrome executable not found. Set DIJIDEMI_LOCAL_CHROME_PATH if needed.');
}

function createProfileDir(username: string): string {
    const profileRoot = path.join(os.homedir(), '.dijidemi-fetch', 'chrome-profiles');
    ensureDirectory(profileRoot);
    return path.join(profileRoot, sanitizeUsername(username));
}

function isChallengeContent(title: string, bodyText: string): boolean {
    const normalized = `${title}\n${bodyText}`.toLowerCase();
    return (
        normalized.includes('just a moment')
        || normalized.includes('bir dakika lütfen')
        || normalized.includes('enable javascript and cookies to continue')
        || normalized.includes('güvenlik doğrulaması gerçekleştirme')
    );
}

function isLoginPage(url: string): boolean {
    return url.toLowerCase().includes('/login');
}

function isDijidemiUrl(url: string): boolean {
    try {
        return new URL(url).hostname.toLowerCase() === 'www.dijidemi.com';
    } catch {
        return false;
    }
}

function extractCookieData(cookies: Awaited<ReturnType<BrowserContext['cookies']>>): CookieData {
    const cookieMap: CookieData = {
        cf_clearance: '',
        'ASP.NET_SessionId': '',
        usrtkn: '',
        '.ASPXAUTH': '',
    };

    for (const cookie of cookies) {
        if (cookie.name in cookieMap) {
            cookieMap[cookie.name] = cookie.value;
        }
    }

    if (cookieMap['ASP.NET_SessionId'] && !cookieMap.usrtkn) {
        cookieMap.usrtkn = `tkn=${cookieMap['ASP.NET_SessionId']}`;
    }

    return cookieMap;
}

function filterBrowserHeaders(headers?: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers || {})) {
        const normalizedKey = key.toLowerCase();
        if (FORBIDDEN_BROWSER_HEADERS.has(normalizedKey) || normalizedKey.startsWith('sec-')) {
            continue;
        }
        result[key] = value;
    }

    return result;
}

async function loadPlaywright(): Promise<PlaywrightModule> {
    return import('playwright');
}

class LocalDijidemiBrowserManager {
    private readonly sessions = new Map<string, LocalBrowserSession>();
    private readonly attempts = new Map<string, LocalLoginAttempt>();
    private readonly userIdToUsername = new Map<string, string>();
    private cleanupRegistered = false;
    private activeUsername: string | null = null;

    isEnabled(): boolean {
        return isLocalBrowserEnvironment();
    }

    startLoginAttempt(credentials: DijidemiLoginCredentials): LocalLoginAttemptSnapshot {
        const username = credentials.username.trim();
        const existingAttempt = this.findOpenAttempt(username);
        if (existingAttempt) {
            return this.toAttemptSnapshot(existingAttempt);
        }

        const attempt: LocalLoginAttempt = {
            id: randomUUID(),
            username,
            password: credentials.password,
            status: 'opening_browser',
            message: 'Chrome başlatılıyor...',
            createdAt: Date.now(),
        };
        this.attempts.set(attempt.id, attempt);

        void this.runLoginAttempt(attempt).catch((error) => {
            const message = error instanceof Error ? error.message : 'Yerel Chrome oturumu başlatılamadı.';
            this.failAttempt(attempt, message);
        });

        return this.toAttemptSnapshot(attempt);
    }

    getAttemptSnapshot(attemptId: string): LocalLoginAttemptSnapshot | null {
        const attempt = this.attempts.get(attemptId);
        return attempt ? this.toAttemptSnapshot(attempt) : null;
    }

    async getAttemptCookies(attemptId: string): Promise<CookieData | null> {
        const attempt = this.attempts.get(attemptId);
        if (!attempt) return null;

        const session = this.sessions.get(attempt.username);
        if (!session || !session.context) return null;
        return extractCookieData(await session.context.cookies());
    }

    async resolveSessionForUserId(userId: string): Promise<SessionResolution> {
        const username = await this.resolveUsernameForUserId(userId);
        if (!username) {
            return {
                status: 'missing',
                message: 'Bu kullanıcı için yerel Dijidemi oturumu bulunamadı.',
            };
        }

        return this.resolveSessionForUsername(username);
    }

    async resolveActiveSession(): Promise<SessionResolution> {
        if (!this.activeUsername) {
            return {
                status: 'missing',
                message: 'Aktif yerel Dijidemi oturumu bulunamadı.',
            };
        }

        return this.resolveSessionForUsername(this.activeUsername);
    }

    async fetchWithUserId(userId: string, request: LocalBrowserFetchRequest): Promise<LocalBrowserFetchResponse> {
        const resolution = await this.resolveSessionForUserId(userId);
        if (resolution.status !== 'ready') {
            throw new Error(resolution.message);
        }

        return this.fetchWithSession(resolution.session, request);
    }

    async fetchWithActiveSession(request: LocalBrowserFetchRequest): Promise<LocalBrowserFetchResponse> {
        const resolution = await this.resolveActiveSession();
        if (resolution.status !== 'ready') {
            throw new Error(resolution.message);
        }

        return this.fetchWithSession(resolution.session, request);
    }

    async getHealthForUserId(userId: string): Promise<'valid' | 'awaiting_verification' | 'missing_upstream_session' | 'error'> {
        try {
            const resolution = await this.resolveSessionForUserId(userId);
            if (resolution.status === 'ready') return 'valid';
            if (resolution.status === 'awaiting_verification') return 'awaiting_verification';
            if (resolution.status === 'missing') return 'missing_upstream_session';
            return 'error';
        } catch (error) {
            console.error('[LocalBrowserManager] Health check failed:', error);
            return 'error';
        }
    }

    async clearSessionForUserId(userId: string): Promise<void> {
        const username = await this.resolveUsernameForUserId(userId);
        if (!username) return;

        const session = this.sessions.get(username);
        if (session?.context) {
            await session.context.close().catch(() => undefined);
        }
        this.sessions.delete(username);
        if (this.activeUsername === username) {
            this.activeUsername = null;
        }
    }

    private async runLoginAttempt(attempt: LocalLoginAttempt): Promise<void> {
        const session = await this.getOrCreateSession(attempt.username);
        const page = await this.ensurePage(session, LOGIN_URL);

        attempt.status = 'awaiting_verification';
        attempt.message = 'Chrome açıldı. Gerekirse Cloudflare doğrulamasını tamamlayın.';

        if (await this.isSessionReady(session, page)) {
            this.markAttemptReady(attempt, session);
            return;
        }

        await this.navigatePage(page, LOGIN_URL);

        let submitted = false;
        const deadline = Date.now() + LOGIN_WAIT_TIMEOUT_MS;

        while (Date.now() < deadline) {
            const snapshot = await this.readPageSnapshot(page);

            if (snapshot.loginErrorText) {
                this.failAttempt(attempt, snapshot.loginErrorText);
                session.status = 'failed';
                session.error = snapshot.loginErrorText;
                return;
            }

            if (!snapshot.challenge && !isLoginPage(snapshot.url)) {
                session.status = 'ready';
                session.lastValidatedAt = Date.now();
                this.markAttemptReady(attempt, session);
                return;
            }

            if (snapshot.loginFormVisible && !submitted) {
                await this.submitLogin(page, attempt.username, attempt.password);
                submitted = true;
                attempt.message = 'Giriş gönderildi. Chrome penceresinde doğrulama tamamlanıyor...';
                await page.waitForTimeout(POLL_INTERVAL_MS).catch(() => undefined);
                continue;
            }

            attempt.message = snapshot.challenge
                ? 'Chrome penceresinde Cloudflare doğrulamasını tamamlayın.'
                : submitted
                    ? 'Giriş tamamlanıyor...'
                    : 'Giriş formu bekleniyor...';

            await page.waitForTimeout(POLL_INTERVAL_MS).catch(() => undefined);
        }

        this.failAttempt(attempt, 'Cloudflare doğrulaması zamanında tamamlanamadı.');
    }

    private async fetchWithSession(
        session: LocalBrowserSession,
        request: LocalBrowserFetchRequest
    ): Promise<LocalBrowserFetchResponse> {
        return this.enqueueSessionRequest(session, async () => {
            const page = await this.ensurePage(session, request.referrer || LMS_INDEX_URL);
            const ready = await this.isSessionReady(session, page);
            if (!ready) {
                throw new Error('Yerel Chrome oturumu doğrulama bekliyor. Chrome penceresinde Dijidemi doğrulamasını tamamlayın.');
            }

            if (request.additionalCookies && session.context) {
                const cookies = Object.entries(request.additionalCookies)
                    .map(([name, value]) => {
                        const normalized = value === null || value === undefined ? '' : String(value).trim();
                        if (!normalized) return null;

                        return {
                            name,
                            value: normalized,
                            url: 'https://www.dijidemi.com/',
                        };
                    })
                    .filter(Boolean) as { name: string; value: string; url: string }[];

                if (cookies.length > 0) {
                    await session.context.addCookies(cookies);
                }
            }

            session.lastActivityAt = Date.now();

            return page.evaluate(
                async ({ url, method, body, headers, referrer }) => {
                    const response = await fetch(url, {
                        method,
                        body,
                        headers,
                        credentials: 'include',
                        redirect: 'follow',
                        referrer,
                        referrerPolicy: 'strict-origin-when-cross-origin',
                    });

                    const text = await response.text();
                    return {
                        status: response.status,
                        url: response.url,
                        headers: Object.fromEntries(response.headers.entries()),
                        body: text,
                    };
                },
                {
                    url: request.url,
                    method: request.method || 'GET',
                    body: request.body,
                    headers: filterBrowserHeaders(request.headers),
                    referrer: request.referrer,
                }
            );
        });
    }

    private async resolveSessionForUsername(username: string): Promise<SessionResolution> {
        const session = await this.getOrCreateSession(username);
        const page = await this.ensurePage(session, LMS_INDEX_URL);

        if (await this.isSessionReady(session, page)) {
            session.status = 'ready';
            session.lastValidatedAt = Date.now();
            this.activeUsername = username;
            return {
                status: 'ready',
                session,
            };
        }

        session.status = 'awaiting_verification';
        return {
            status: 'awaiting_verification',
            message: 'Yerel Chrome oturumu doğrulama bekliyor. Lütfen tekrar giriş yapın veya açık Chrome penceresinde doğrulamayı tamamlayın.',
        };
    }

    private async getOrCreateSession(username: string): Promise<LocalBrowserSession> {
        let session = this.sessions.get(username);
        if (!session) {
            session = {
                username,
                userDataDir: createProfileDir(username),
                context: null,
                page: null,
                status: 'launching',
                lastValidatedAt: 0,
                lastActivityAt: 0,
                launchPromise: null,
                requestQueue: Promise.resolve(),
            };
            this.sessions.set(username, session);
        }

        await this.ensureContext(session);
        return session;
    }

    private async ensureContext(session: LocalBrowserSession): Promise<BrowserContext> {
        if (session.context) {
            return session.context;
        }

        if (session.launchPromise) {
            return session.launchPromise;
        }

        this.registerCleanup();

        session.launchPromise = (async () => {
            ensureDirectory(session.userDataDir);
            const chromeExecutable = findChromeExecutable();
            const { chromium } = await loadPlaywright();
            const context = await chromium.launchPersistentContext(session.userDataDir, {
                headless: false,
                executablePath: chromeExecutable,
                viewport: null,
                locale: 'tr-TR',
                timezoneId: 'Europe/Istanbul',
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-default-browser-check',
                    '--no-first-run',
                    '--start-maximized',
                ],
            });

            await context.addInitScript({ content: STEALTH_INIT_SCRIPT });
            await context.setExtraHTTPHeaders({
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
            });

            context.on('close', () => {
                session.context = null;
                session.page = null;
                session.status = 'failed';
                if (this.activeUsername === session.username) {
                    this.activeUsername = null;
                }
            });

            session.context = context;
            session.status = 'awaiting_verification';
            session.error = undefined;

            const pages = context.pages().filter((page) => !page.isClosed());
            session.page = pages[0] || null;
            return context;
        })().finally(() => {
            session.launchPromise = null;
        });

        return session.launchPromise;
    }

    private async enqueueSessionRequest<T>(
        session: LocalBrowserSession,
        operation: () => Promise<T>
    ): Promise<T> {
        const nextRun = session.requestQueue.catch(() => undefined).then(operation);
        session.requestQueue = nextRun.then(() => undefined, () => undefined);
        return nextRun;
    }

    private async ensurePage(session: LocalBrowserSession, desiredUrl: string): Promise<Page> {
        const context = await this.ensureContext(session);

        if (!session.page || session.page.isClosed()) {
            const pages = context.pages().filter((page) => !page.isClosed());
            session.page = pages[0] || null;
        }

        if (!session.page) {
            session.page = await context.newPage();
        }

        try {
            await session.page.bringToFront();
        } catch {
            // no-op
        }

        const currentUrl = session.page.url();
        if (!currentUrl || currentUrl === 'about:blank' || !isDijidemiUrl(currentUrl)) {
            await this.navigatePage(session.page, desiredUrl);
        }

        return session.page;
    }

    private async isSessionReady(session: LocalBrowserSession, page: Page): Promise<boolean> {
        if (session.lastValidatedAt && (Date.now() - session.lastValidatedAt) < SESSION_STALE_MS) {
            return session.status === 'ready';
        }

        const snapshot = await this.readPageSnapshot(page);
        const ready = isDijidemiUrl(snapshot.url) && !snapshot.challenge && !isLoginPage(snapshot.url);
        if (ready) {
            session.lastValidatedAt = Date.now();
            session.status = 'ready';
            session.error = undefined;
        }
        return ready;
    }

    private async navigatePage(page: Page, url: string): Promise<void> {
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        }).catch(() => undefined);
    }

    private async submitLogin(page: Page, username: string, password: string): Promise<void> {
        await page.fill('#txtUserName', username);
        await page.fill('#txtPassword', password);
        await page.click('#btnLogin');
    }

    private async readPageSnapshot(page: Page): Promise<PageSnapshot> {
        const title = (await page.title().catch(() => '')) || '';
        const url = page.url();
        const bodyText = ((await page.locator('body').textContent().catch(() => '')) || '').trim();
        const loginFormVisible = await page.locator('#txtUserName').isVisible().catch(() => false);

        let loginErrorText: string | null = null;
        for (const selector of LOGIN_ERROR_SELECTORS) {
            const locator = page.locator(selector).first();
            const visible = await locator.isVisible().catch(() => false);
            if (!visible) continue;

            const text = (await locator.textContent().catch(() => null))?.trim();
            if (text) {
                loginErrorText = text;
                break;
            }
        }

        return {
            url,
            title,
            bodyText,
            loginFormVisible,
            loginErrorText,
            challenge: isChallengeContent(title, bodyText),
        };
    }

    private async resolveUsernameForUserId(userId: string): Promise<string | null> {
        const cached = this.userIdToUsername.get(userId);
        if (cached) {
            return cached;
        }

        const { data, error } = await supabase
            .from('users')
            .select('external_id')
            .eq('id', userId)
            .single();

        if (error || !data?.external_id) {
            return null;
        }

        this.userIdToUsername.set(userId, data.external_id);
        return data.external_id;
    }

    rememberUser(userId: string, username: string): void {
        this.userIdToUsername.set(userId, username);
        this.activeUsername = username;
    }

    private findOpenAttempt(username: string): LocalLoginAttempt | null {
        for (const attempt of this.attempts.values()) {
            if (attempt.username !== username) continue;
            if (attempt.status === 'opening_browser' || attempt.status === 'awaiting_verification') {
                return attempt;
            }
        }
        return null;
    }

    private markAttemptReady(attempt: LocalLoginAttempt, session: LocalBrowserSession): void {
        attempt.status = 'ready';
        attempt.message = 'Dijidemi oturumu hazır.';
        attempt.error = undefined;
        session.status = 'ready';
        session.lastValidatedAt = Date.now();
        session.lastActivityAt = Date.now();
        session.error = undefined;
        this.activeUsername = session.username;
    }

    private failAttempt(attempt: LocalLoginAttempt, message: string): void {
        attempt.status = 'failed';
        attempt.message = message;
        attempt.error = message;
    }

    private toAttemptSnapshot(attempt: LocalLoginAttempt): LocalLoginAttemptSnapshot {
        return {
            attemptId: attempt.id,
            username: attempt.username,
            status: attempt.status,
            message: attempt.message,
            error: attempt.error,
        };
    }

    private registerCleanup(): void {
        if (this.cleanupRegistered) return;
        this.cleanupRegistered = true;

        const cleanup = async () => {
            const sessions = Array.from(this.sessions.values());
            for (const session of sessions) {
                if (session.context) {
                    await session.context.close().catch(() => undefined);
                }
            }
        };

        process.once('SIGINT', () => {
            void cleanup().finally(() => process.exit(0));
        });
        process.once('SIGTERM', () => {
            void cleanup().finally(() => process.exit(0));
        });
        process.once('exit', () => {
            void cleanup();
        });
    }
}

declare global {
    // eslint-disable-next-line no-var
    var __dijidemiLocalBrowserManager: LocalDijidemiBrowserManager | undefined;
}

export const localDijidemiBrowserManager = globalThis.__dijidemiLocalBrowserManager
    ?? (globalThis.__dijidemiLocalBrowserManager = new LocalDijidemiBrowserManager());

export function isLocalBrowserMode(): boolean {
    return localDijidemiBrowserManager.isEnabled();
}
