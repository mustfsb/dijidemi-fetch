import { NextRequest, NextResponse } from 'next/server';
import {
    createDijidemiChallengeResponse,
    createMissingDijidemiSessionResponse,
} from '@/lib/auth';

export class BufferedUpstreamResponse {
    readonly status: number;
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly is_base64?: boolean;

    constructor(init: {
        status: number;
        url: string;
        headers: Record<string, string>;
        body: string;
        is_base64?: boolean;
    }) {
        this.status = init.status;
        this.url = init.url;
        this.headers = init.headers;
        this.body = init.body;
        this.is_base64 = init.is_base64;
    }

    get ok(): boolean {
        return this.status >= 200 && this.status < 300;
    }

    async text(): Promise<string> {
        if (this.is_base64) {
            return Buffer.from(this.body, 'base64').toString('utf8');
        }
        return this.body;
    }

    async json<T = unknown>(): Promise<T> {
        return JSON.parse(await this.text()) as T;
    }
    
    async arrayBuffer(): Promise<ArrayBuffer> {
        if (this.is_base64) {
            const buf = Buffer.from(this.body, 'base64');
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        }
        return Buffer.from(this.body, 'utf8').buffer;
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

    const pythonApiUrl = process.env.DIJIDEMI_PYTHON_API_URL || "http://127.0.0.1:8000";

    try {
        const response = await fetch(`${pythonApiUrl}/api/proxy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url,
                method,
                headers,
                body,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return NextResponse.json(
                { error: errorData.detail || 'Python API proxy failed.' },
                { status: response.status }
            );
        }

        const result = await response.json();

        if (isChallengePayload(result.status, result.body)) {
            return createDijidemiChallengeResponse();
        }

        return new BufferedUpstreamResponse({
            status: result.status,
            url: result.url || url,
            headers: result.headers,
            body: result.body,
            is_base64: result.is_base64,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Python Bot proxy failed.';
        return NextResponse.json({ error: message }, { status: 503 });
    }
}
