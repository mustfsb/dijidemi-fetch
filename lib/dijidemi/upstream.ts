import { NextRequest, NextResponse } from 'next/server';
import {
    createDijidemiChallengeResponse,
    createMissingDijidemiSessionResponse,
} from '@/lib/auth';
import { isLocalBrowserMode, localDijidemiBrowserManager } from '@/lib/dijidemi/localBrowserManager';
import { fetchViaBrowser } from '@/lib/dijidemi/productionBrowserManager';
import cookieManager from '@/lib/cookie/cookieManager';

export class BufferedUpstreamResponse {
    readonly status: number;
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly body: string;

    constructor(init: {
        status: number;
        url: string;
        headers: Record<string, string>;
        body: string;
    }) {
        this.status = init.status;
        this.url = init.url;
        this.headers = init.headers;
        this.body = init.body;
    }

    get ok(): boolean {
        return this.status >= 200 && this.status < 300;
    }

    async text(): Promise<string> {
        return this.body;
    }

    async json<T = unknown>(): Promise<T> {
        return JSON.parse(this.body) as T;
    }
}

interface SharedRequestOptions {
    request: NextRequest;
    url: string;
    method?: 'GET' | 'POST';
    userId?: string;
    headers?: Record<string, string>;
    body?: string;
    additionalCookies?: Record<string, string | number | null | undefined>;
    requireSession?: boolean;
    referrer?: string;
}

function isChallengePayload(status: number, body: string): boolean {
    const normalized = body.toLowerCase();
    return status === 403 && (
        normalized.includes('just a moment')
        || normalized.includes('bir dakika lütfen')
        || normalized.includes('enable javascript and cookies to continue')
        || normalized.includes('güvenlik doğrulaması gerçekleştirme')
    );
}


export async function requestDijidemiUpstream(
    options: SharedRequestOptions
): Promise<BufferedUpstreamResponse | NextResponse> {
    const {
        request,
        url,
        method = 'GET',
        userId,
        headers,
        body,
        additionalCookies,
        requireSession = true,
        referrer,
    } = options;

    if (isLocalBrowserMode()) {
        try {
            const browserResponse = userId
                ? await localDijidemiBrowserManager.fetchWithUserId(userId, {
                    url,
                    method,
                    headers,
                    body,
                    additionalCookies,
                    referrer,
                })
                : await localDijidemiBrowserManager.fetchWithActiveSession({
                    url,
                    method,
                    headers,
                    body,
                    additionalCookies,
                    referrer,
                });

            if (isChallengePayload(browserResponse.status, browserResponse.body)) {
                return createDijidemiChallengeResponse();
            }

            return new BufferedUpstreamResponse(browserResponse);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Yerel browser oturumu kullanılamıyor.';
            return NextResponse.json(
                { error: message },
                { status: 503 }
            );
        }
    }

    // Use shared automation cookies from Supabase, then make the request through
    // a real Chromium browser context to preserve Chrome's TLS fingerprint.
    const cookies = await cookieManager.getCookies();
    const hasCfClearance = cookies.some(c => c.name === 'cf_clearance' && c.value);
    if (!hasCfClearance) {
        return createMissingDijidemiSessionResponse();
    }

    let result: { status: number; url: string; headers: Record<string, string>; body: string };
    try {
        result = await fetchViaBrowser(
            { url, method, headers, body, additionalCookies, referrer },
            cookies
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Browser request failed.';
        return NextResponse.json({ error: message }, { status: 503 });
    }

    if (isChallengePayload(result.status, result.body)) {
        return createDijidemiChallengeResponse();
    }

    return new BufferedUpstreamResponse({
        status: result.status,
        url: result.url || url,
        headers: result.headers,
        body: result.body,
    });
}
