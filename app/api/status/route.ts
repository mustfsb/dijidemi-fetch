import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import { requestUpstreamApi } from '@/lib/upstreamApi';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    // Auth check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Read-only session health endpoint
    const ip = getClientIp(request);
    if (!(await RateLimits.GENERAL(ip, auth.userId))) {
        return NextResponse.json({ status: 'error', message: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    try {
        const response = await requestUpstreamApi({
            path: '/health',
            method: 'GET',
            includeAuthorization: false,
        });

        if (response instanceof NextResponse) {
            return NextResponse.json({ status: 'error' });
        }

        return NextResponse.json({
            status: response.ok ? 'valid' : 'error',
        });
    } catch (e) {
        console.error('Status check error:', e);
        return NextResponse.json({ status: 'error' });
    }
}
