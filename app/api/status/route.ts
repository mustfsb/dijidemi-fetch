import { NextRequest, NextResponse } from 'next/server';
import { getDijidemiSessionHealth, requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

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
        return NextResponse.json({
            status: await getDijidemiSessionHealth(request, auth.userId),
        });
    } catch (e) {
        console.error('Status check error:', e);
        return NextResponse.json({ status: 'error' });
    }
}
