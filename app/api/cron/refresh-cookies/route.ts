import { NextRequest, NextResponse } from 'next/server';
import cookieManager from '@/lib/cookie/cookieManager';

export async function GET(request: NextRequest) {
    // Verify request is from authorized cron source
    const configuredSecret = process.env.CRON_SECRET?.trim();
    if (!configuredSecret) {
        return NextResponse.json({ success: false, error: 'CRON_SECRET is not configured' }, { status: 500 });
    }
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${configuredSecret}`) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        console.log('Cron job triggered: Refreshing cookies...');
        await cookieManager.refreshCookies();
        return NextResponse.json({ success: true, message: 'Cookies refreshed' });
    } catch (error) {
        console.error('Cron job failed:', error);
        return NextResponse.json({ success: false, error: 'Failed to refresh cookies' }, { status: 500 });
    }
}
