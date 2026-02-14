import { NextRequest, NextResponse } from 'next/server';
import cookieManager from '@/lib/cookie/cookieManager';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
    // Auth check
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Rate limit
    const ip = getClientIp(request);
    if (!RateLimits.GENERAL(ip)) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const testId = searchParams.get('testId');
    const programId = searchParams.get('programId') || '14308';
    
    if (!testId) {
        return NextResponse.json({ error: 'Missing testId' }, { status: 400 });
    }

    try {
        const headers = await cookieManager.getHeaders();
        const url = `https://www.dijidemi.com/MobilService/GetTestById?testId=${testId}&programId=${programId}&testTur=1`;
        
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            return NextResponse.json({ error: `Dijidemi API Error: ${response.status}` }, { status: response.status });
        }

        const data = await response.json();
        
        // Extract a clean title from the response
        // Usually it's in data.Adi or data.Test.Adi or similar
        const title = data.Adi || (data.Test && data.Test.Adi) || `KTT #${testId}`;
        
        return NextResponse.json({ success: true, title, data });
    } catch (error: any) {
        console.error('Fetch Test Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
