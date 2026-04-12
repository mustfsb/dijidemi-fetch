import { NextRequest, NextResponse } from 'next/server';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import {
    extractTestIdFromPayload,
    readBufferedUpstreamPayload,
    requestUpstreamApi,
} from '@/lib/upstreamApi';

export const maxDuration = 25;

interface AssignmentTestResponse {
    success: boolean;
    testId?: string;
    error?: string;
}

const NUMERIC_ID_PATTERN = /^\d+$/;

function parseNumericId(value: unknown, field: string): string | NextResponse<AssignmentTestResponse> {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return NextResponse.json({ success: false, error: `${field} gerekli` }, { status: 400 });
    }
    const normalized = String(value).trim();
    if (!normalized || normalized.length > 128 || !NUMERIC_ID_PATTERN.test(normalized)) {
        return NextResponse.json({ success: false, error: `Geçersiz ${field}` }, { status: 400 });
    }
    return normalized;
}

export async function POST(request: NextRequest): Promise<NextResponse<AssignmentTestResponse>> {
    try {
        // Auth check
        const auth = await requireAuth(request);
        if (auth instanceof NextResponse) return auth as NextResponse<AssignmentTestResponse>;

        // Rate limit
        const ip = getClientIp(request);
        if (!(await RateLimits.GENERAL(ip, auth.userId))) {
            return NextResponse.json({ success: false, error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
        }

        let body: { odevId?: string };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ success: false, error: 'Geçersiz JSON gövdesi' }, { status: 400 });
        }
        const odevId = parseNumericId(body.odevId, 'Ödev ID');
        if (odevId instanceof NextResponse) return odevId;

        const response = await requestUpstreamApi({
            path: '/api/proxy',
            method: 'POST',
            json: {
                url: `https://www.dijidemi.com/Ogrenci/Odev?id=${encodeURIComponent(odevId)}`,
                method: 'GET',
            },
        });
        if (response instanceof NextResponse) return response as NextResponse<AssignmentTestResponse>;

        if (!response.ok) {
            return NextResponse.json({
                success: false,
                error: `Ödev sayfası alınamadı: ${response.status}`
            }, { status: response.status });
        }

        const payload = readBufferedUpstreamPayload(response);
        const testId = extractTestIdFromPayload(payload);

        if (!testId) {
            const payloadRecord = (
                payload
                && typeof payload === 'object'
                && !Array.isArray(payload)
            ) ? payload as Record<string, unknown> : null;
            const html = typeof payloadRecord?.body === 'string' ? payloadRecord.body : null;

            if (process.env.NODE_ENV === 'development' && html) {
                const testIdContext = html.match(/.{0,50}TestId.{0,50}/gi);
                console.log('TestId context:', testIdContext?.slice(0, 3));
            }
        }

        if (!testId) {
            return NextResponse.json({
                success: false,
                error: 'TestId bulunamadı'
            }, { status: 404 });
        }

        return NextResponse.json({ success: true, testId });

    } catch (error) {
        console.error('Assignment Test API Error:', error);
        return NextResponse.json({
            success: false,
            error: 'Sunucu hatası oluştu'
        }, { status: 500 });
    }

}
