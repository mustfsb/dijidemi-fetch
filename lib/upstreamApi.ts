import { NextResponse } from 'next/server';
import type { Assignment, Test } from '@/types';

const DEFAULT_UPSTREAM_API_BASE_URL = 'http://194.62.55.93:8000';
const DEFAULT_UPSTREAM_API_TOKEN = 'aBcD';
const DEFAULT_UPSTREAM_API_TIMEOUT_MS = 15000;

export const UPSTREAM_API_DEFAULTS = Object.freeze({
    programId: '14308',
    turID: '2',
    turId: '2',
    dersId: '969',
    odevId: '0',
});

type QueryValue = string | number | boolean | null | undefined;

interface RequestUpstreamApiOptions {
    path: string;
    method?: 'GET' | 'POST';
    query?: Record<string, QueryValue>;
    headers?: Record<string, string>;
    body?: string;
    json?: unknown;
    includeAuthorization?: boolean;
}

function getUpstreamApiBaseUrl(): string {
    const configured = process.env.DIJIDEMI_API_BASE_URL?.trim();
    const baseUrl = configured || DEFAULT_UPSTREAM_API_BASE_URL;
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function getUpstreamApiToken(): string {
    return process.env.DIJIDEMI_API_BEARER_TOKEN?.trim() || DEFAULT_UPSTREAM_API_TOKEN;
}

function getUpstreamApiTimeoutMs(): number {
    const configured = Number(process.env.DIJIDEMI_API_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_UPSTREAM_API_TIMEOUT_MS;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string | null {
    if (typeof value === 'string') {
        const normalized = value.trim();
        return normalized || null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return null;
}

function safeJsonParse<T>(value: string): T | null {
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function extractPayloadArray(record: Record<string, unknown>, keys: string[]): unknown[] | null {
    for (const key of keys) {
        const value = record[key];
        if (Array.isArray(value)) {
            return value;
        }

        const nested = normalizeRecord(value);
        if (!nested) continue;

        const nestedArray = extractPayloadArray(nested, keys);
        if (nestedArray) {
            return nestedArray;
        }
    }

    return null;
}

function extractPayloadText(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = toTrimmedString(record[key]);
        if (value) {
            return value;
        }

        const nested = normalizeRecord(record[key]);
        if (!nested) continue;

        const nestedText = extractPayloadText(nested, keys);
        if (nestedText) {
            return nestedText;
        }
    }

    return null;
}

function buildHomeworkLink(id: string): string {
    void id;
    return '';
}

function coerceTest(value: unknown): Test | null {
    const record = normalizeRecord(value);
    if (!record) return null;

    const id = toTrimmedString(
        record.id
        ?? record.Id
        ?? record.testId
        ?? record.TestId
        ?? record.rowId
        ?? record.RowId
    );
    const name = toTrimmedString(
        record.name
        ?? record.Name
        ?? record.title
        ?? record.Title
        ?? record.Adi
        ?? record.TestAdi
        ?? record.testAdi
        ?? record.Baslik
        ?? record.baslik
    );

    if (!id || !name) return null;

    return {
        id,
        name: decodeHtmlEntities(name).replace(/\s+/g, ' '),
    };
}

function coerceAssignment(value: unknown): Assignment | null {
    const record = normalizeRecord(value);
    if (!record) return null;

    const id = toTrimmedString(
        record.id
        ?? record.Id
        ?? record.assignmentId
        ?? record.AssignmentId
        ?? record.odevId
        ?? record.odevID
        ?? record.homeworkId
        ?? record.homework_identifier
        ?? record.rowId
    );
    if (!id) return null;

    const rawTitle = toTrimmedString(
        record.title
        ?? record.Title
        ?? record.name
        ?? record.Name
        ?? record.Adi
        ?? record.description
        ?? record.Description
    );
    const rawDateRange = toTrimmedString(
        record.dateRange
        ?? record.DateRange
        ?? record.date
        ?? record.Date
        ?? record.tarih
        ?? record.Tarih
    );
    const rawType = toTrimmedString(record.type ?? record.Type);

    return {
        id,
        title: decodeHtmlEntities(rawTitle || `Ödev ${id}`).replace(/\s+/g, ' '),
        dateRange: decodeHtmlEntities(rawDateRange || '').replace(/\s+/g, ' '),
        link: buildHomeworkLink(id),
        type: rawType === 'ktt' ? 'ktt' : 'assignment',
    };
}

export class BufferedUpstreamApiResponse {
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

    get contentType(): string {
        return this.headers['content-type'] || '';
    }

    async text(): Promise<string> {
        return this.body;
    }

    async json<T = unknown>(): Promise<T> {
        return JSON.parse(this.body) as T;
    }
}

export function buildUpstreamApiUrl(path: string, query: Record<string, QueryValue> = {}): string {
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(normalizedPath, getUpstreamApiBaseUrl());

    for (const [key, value] of Object.entries(query)) {
        if (value === null || value === undefined) continue;
        url.searchParams.set(key, String(value));
    }

    return url.toString();
}

export async function requestUpstreamApi(
    options: RequestUpstreamApiOptions
): Promise<BufferedUpstreamApiResponse | NextResponse> {
    const {
        path,
        method = 'GET',
        query,
        headers,
        body,
        json,
        includeAuthorization = true,
    } = options;

    const targetUrl = buildUpstreamApiUrl(path, query);

    try {
        // Build headers as a plain object so the native fetch does NOT inherit
        // any browser/Next.js context headers (Origin, Referer, x-* etc.).
        const rawHeaders: Record<string, string> = {};

        if (includeAuthorization) {
            rawHeaders['Authorization'] = `Bearer ${getUpstreamApiToken()}`;
        }

        // Merge any explicitly caller-supplied headers (none for most routes).
        if (headers) {
            for (const [k, v] of Object.entries(headers)) {
                rawHeaders[k] = v;
            }
        }

        let requestBody: string | undefined = body;
        if (json !== undefined) {
            requestBody = JSON.stringify(json);
            rawHeaders['Content-Type'] = 'application/json';
        }

        console.log(`[upstream] → ${method} ${targetUrl}`);

        const response = await fetch(targetUrl, {
            method,
            headers: rawHeaders,
            body: requestBody,
            // Bypass Next.js fetch cache entirely
            cache: 'no-store',
            // @ts-ignore – undici-specific: forces HTTP/1.1, avoids keep-alive pooling issues
            duplex: 'half',
            signal: AbortSignal.timeout(getUpstreamApiTimeoutMs()),
        });

        console.log(`[upstream] ← ${response.status} ${targetUrl}`);

        return new BufferedUpstreamApiResponse({
            status: response.status,
            url: response.url,
            headers: Object.fromEntries(response.headers.entries()),
            body: await response.text(),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Upstream request failed.';
        console.error(`[upstream] ✗ ${method} ${targetUrl} — ${message}`);
        const status = error instanceof Error && error.name === 'TimeoutError' ? 504 : 503;
        return NextResponse.json({ error: message }, { status });
    }
}

export function readBufferedUpstreamPayload(response: BufferedUpstreamApiResponse): unknown {
    const body = response.body.trim();
    if (!body) return '';

    if (response.contentType.includes('application/json')) {
        return safeJsonParse(body) ?? body;
    }

    if (
        (body.startsWith('{') && body.endsWith('}'))
        || (body.startsWith('[') && body.endsWith(']'))
    ) {
        return safeJsonParse(body) ?? body;
    }

    return response.body;
}

export function parseBookTestsFromHtml(html: string): Test[] {
    const regex = /<h3>(.*?)<\/h3>[\s\S]*?data-rowid="(\d+)"/g;

    return [...html.matchAll(regex)].map((match) => ({
        name: decodeHtmlEntities(match[1].trim()).replace(/\s+/g, ' '),
        id: match[2],
    }));
}

export function parseBookTestsPayload(payload: unknown): Test[] {
    if (typeof payload === 'string') {
        return parseBookTestsFromHtml(payload);
    }

    if (Array.isArray(payload)) {
        return payload.map(coerceTest).filter((item): item is Test => Boolean(item));
    }

    const record = normalizeRecord(payload);
    if (!record) return [];

    const arrayPayload = extractPayloadArray(record, ['tests', 'data', 'items', 'result']);
    if (arrayPayload) {
        const parsed = arrayPayload.map(coerceTest).filter((item): item is Test => Boolean(item));
        if (parsed.length > 0) return parsed;
    }

    const textPayload = extractPayloadText(record, ['html', 'body', 'content', 'data', 'result']);
    if (textPayload) {
        return parseBookTestsFromHtml(textPayload);
    }

    return [];
}

export function parseAssignmentsFromHtml(html: string): Assignment[] {
    const assignments: Assignment[] = [];
    const primaryPattern = /<p class="font-small-1 m-0">([^<]+)<\/p>\s*<span>\s*([^<]+)\s*<\/span>[\s\S]*?data-rowid="(\d+)"/g;

    let match: RegExpExecArray | null;
    while ((match = primaryPattern.exec(html)) !== null) {
        assignments.push({
            id: match[3],
            title: decodeHtmlEntities(match[1].trim()).replace(/\s+/g, ' '),
            dateRange: decodeHtmlEntities(match[2].trim()).replace(/\s+/g, ' '),
            link: buildHomeworkLink(match[3]),
            type: 'assignment',
        });
    }

    if (assignments.length > 0) {
        return assignments;
    }

    const rowIdPattern = /data-rowid="(\d+)"/g;
    const seenIds = new Set<string>();

    while ((match = rowIdPattern.exec(html)) !== null) {
        const id = match[1];
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        assignments.push({
            id,
            title: `Ödev ${seenIds.size}`,
            dateRange: '',
            link: buildHomeworkLink(id),
            type: 'assignment',
        });
    }

    return assignments;
}

export function parseAssignmentsPayload(payload: unknown): Assignment[] {
    if (typeof payload === 'string') {
        return parseAssignmentsFromHtml(payload);
    }

    if (Array.isArray(payload)) {
        return payload.map(coerceAssignment).filter((item): item is Assignment => Boolean(item));
    }

    const record = normalizeRecord(payload);
    if (!record) return [];

    const arrayPayload = extractPayloadArray(record, ['assignments', 'data', 'items', 'result']);
    if (arrayPayload) {
        const parsed = arrayPayload
            .map(coerceAssignment)
            .filter((item): item is Assignment => Boolean(item));
        if (parsed.length > 0) return parsed;
    }

    const textPayload = extractPayloadText(record, ['html', 'body', 'content', 'data', 'result']);
    if (textPayload) {
        return parseAssignmentsFromHtml(textPayload);
    }

    return [];
}

function extractTestIdFromHtml(html: string): string | null {
    const patterns = [
        /name=["']TestId["'][^>]*value=["'](\d+)["']/i,
        /data-testid=["'](\d+)["']/i,
        /TestId['":\s=]+['"]?(\d+)['"]?/i,
        /testId['":\s=]+['"]?(\d+)['"]?/i,
        /id=["']TestId["'][^>]*value=["'](\d+)["']/i,
        /value=["'](\d+)["'][^>]*(?:name|id)=["']TestId["']/i,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }

    return null;
}

export function extractTestIdFromPayload(payload: unknown): string | null {
    if (typeof payload === 'string') {
        const directValue = toTrimmedString(payload);
        if (directValue && /^\d+$/.test(directValue)) {
            return directValue;
        }

        return extractTestIdFromHtml(payload);
    }

    const record = normalizeRecord(payload);
    if (!record) return null;

    const directId = toTrimmedString(record.testId ?? record.TestId ?? record.id ?? record.Id);
    if (directId && /^\d+$/.test(directId)) {
        return directId;
    }

    for (const key of ['data', 'result', 'test', 'payload']) {
        const nestedValue = record[key];
        const nestedId = extractTestIdFromPayload(nestedValue);
        if (nestedId) {
            return nestedId;
        }
    }

    const htmlPayload = extractPayloadText(record, ['html', 'body', 'content']);
    if (htmlPayload) {
        return extractTestIdFromHtml(htmlPayload);
    }

    return null;
}

export function extractVideoUrlFromHtml(html: string): string | null {
    const patterns = [
        /<video[^>]*src="([^"]+)"/i,
        /<source[^>]*src="([^"]+)"/i,
        /"([^"]+\.mp4)"/i,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }

    return null;
}

export function extractVideoUrlFromPayload(payload: unknown): string | null {
    if (typeof payload === 'string') {
        const normalized = payload.trim();
        if (/^https?:\/\//i.test(normalized)) {
            return normalized;
        }

        return extractVideoUrlFromHtml(payload);
    }

    const record = normalizeRecord(payload);
    if (!record) return null;

    const directUrl = toTrimmedString(
        record.videoUrl
        ?? record.VideoUrl
        ?? record.url
        ?? record.Url
        ?? record.src
        ?? record.Src
        ?? record.mp4
    );
    if (directUrl) {
        return directUrl;
    }

    for (const key of ['data', 'result', 'payload']) {
        const nestedUrl = extractVideoUrlFromPayload(record[key]);
        if (nestedUrl) {
            return nestedUrl;
        }
    }

    const htmlPayload = extractPayloadText(record, ['html', 'body', 'content']);
    if (htmlPayload) {
        return extractVideoUrlFromHtml(htmlPayload);
    }

    return null;
}
