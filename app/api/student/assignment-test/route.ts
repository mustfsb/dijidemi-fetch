import { NextRequest, NextResponse } from 'next/server';
import cookieManager from '@/lib/cookie/cookieManager';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

interface AssignmentTestResponse {
    success: boolean;
    testId?: string;
    error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<AssignmentTestResponse>> {
    try {
        // Auth check
        const auth = requireAuth(request);
        if (auth instanceof NextResponse) return auth as NextResponse<AssignmentTestResponse>;

        // Rate limit
        const ip = getClientIp(request);
        if (!RateLimits.GENERAL(ip, auth.userId)) {
            return NextResponse.json({ success: false, error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
        }

        let body: { odevId?: string };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ success: false, error: 'Geçersiz JSON gövdesi' }, { status: 400 });
        }
        const { odevId } = body;

        if (!odevId) {
            return NextResponse.json({ success: false, error: 'Ödev ID gerekli' }, { status: 400 });
        }
        if (String(odevId).length > 128) {
            return NextResponse.json({ success: false, error: 'Geçersiz Ödev ID' }, { status: 400 });
        }

        // Get auth headers
        const authHeaders = await cookieManager.getHeaders();
        const baseCookie = authHeaders['Cookie'] || '';
        const fullCookie = `${baseCookie}; kullaniciId = 0; soruCevap = { "0": {} }`;

        // Fetch the assignment page to get the TestId
        const url = `https://www.dijidemi.com/Ogrenci/Odev?id=${odevId}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Cookie': fullCookie,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': 'https://www.dijidemi.com/Ogrenci',
            },
        });

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
