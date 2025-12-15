import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import cookieManager from '@/lib/cookie/cookieManager';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const force = searchParams.get('force') === 'true';

        const { data, error } = await supabase
            .from('auth_cookies')
            .select('updated_at')
            .limit(1)
            .single();

        let shouldRefresh = force;

        if (!shouldRefresh) {
            if (error || !data) {
                shouldRefresh = true;
            } else {
                const lastUpdate = new Date(data.updated_at).getTime();
                const now = Date.now();
                const diff = now - lastUpdate;
                const TWO_HOURS = 1000 * 60 * 60 * 2;

                if (diff > TWO_HOURS) {
                    // User requested to disable auto-refresh on time check.
                    // Only forced refresh or missing data triggers refresh.
                    // shouldRefresh = true;
                    console.log(`Cookies are ${Math.floor(diff / 1000 / 60)} minutes old, but auto-refresh is disabled.`);
                }
            }
        }

        if (shouldRefresh) {
            console.log(`Status check: ${force ? 'Forced' : 'Stale cookies detected'}. Triggering refresh...`);
            // This might take time (10-20s). The client request will hang until finished.
            // This is acceptable as it ensures the next action succeeds.
            try {
                await cookieManager.refreshCookies();
                return NextResponse.json({ status: 'valid', message: 'Refreshed successfully' });
            } catch (refreshError) {
                console.error('Auto-refresh failed:', refreshError);
                return NextResponse.json({ status: 'error', message: 'Refresh failed' });
            }
        }

        return NextResponse.json({ status: 'valid' });
    } catch (e) {
        console.error('Status check error:', e);
        return NextResponse.json({ status: 'error' });
    }
}
