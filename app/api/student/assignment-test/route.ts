import { NextRequest, NextResponse } from 'next/server';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { RateLimits } from '@/lib/rate-limit';

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

        // Fetch the assignment page to get the TestId
        const url = new URL('https://www.dijidemi.com/Ogrenci/Odev');
        url.searchParams.set('id', odevId);

        const response = await requestDijidemiUpstream({
            request,
            userId: auth.userId,
            url: url.toString(),
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            additionalCookies: {
                kullaniciId: '0',
                soruCevap: JSON.stringify({ 0: {} }),
            },
            referrer: 'https://www.dijidemi.com/Ogrenci',
        });
        if (response instanceof NextResponse) return response as NextResponse<AssignmentTestResponse>;

        if (!response.ok) {
            return NextResponse.json({
                success: false,
                error: `Ödev sayfası alınamadı: ${response.status}`
            }, { status: response.status });
        }

        const html = await response.text();

        // Try multiple patterns to find TestId
        const patterns = [
            // Pattern 1: TestId in hidden input
            /name=["']TestId["'][^>]*value=["'](\d+)["']/i,
            // Pattern 2: TestId in data attribute
            /data-testid=["'](\d+)["']/i,
            // Pattern 3: TestId in JavaScript variable
            /TestId['":\s=]+['"]?(\d+)['"]?/i,
            // Pattern 4: testId in any format
            /testId['":\s=]+['"]?(\d+)['"]?/i,
            // Pattern 5: input with id TestId
            /id=["']TestId["'][^>]*value=["'](\d+)["']/i,
            // Pattern 6: value first, then name/id
            /value=["'](\d+)["'][^>]*(?:name|id)=["']TestId["']/i,
        ];

        let testId: string | null = null;

        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                testId = match[1];
                break;
            }
        }

        if (!testId) {
            // Log minimal context in development only
            if (process.env.NODE_ENV === 'development') {
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
