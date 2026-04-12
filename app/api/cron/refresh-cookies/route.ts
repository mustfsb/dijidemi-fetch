import { NextRequest, NextResponse } from 'next/server';
import {
    readBufferedUpstreamPayload,
    requestUpstreamApi,
} from '@/lib/upstreamApi';

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
        const response = await requestUpstreamApi({
            path: '/api/refresh-cookies',
            method: 'POST',
        });

        if (response instanceof NextResponse) {
            return response;
        }

        const payload = readBufferedUpstreamPayload(response);
        const payloadRecord = (
            payload
            && typeof payload === 'object'
            && !Array.isArray(payload)
        ) ? payload as Record<string, unknown> : null;

        if (!response.ok) {
            const errorMessage = typeof payloadRecord?.error === 'string'
                ? payloadRecord.error
                : 'Failed to refresh upstream state';

            return NextResponse.json({ success: false, error: errorMessage }, { status: response.status });
        }

        if (payloadRecord) {
            return NextResponse.json(payloadRecord);
        }

        return NextResponse.json({ success: true, message: 'Refresh triggered' });
    } catch (error) {
        console.error('Cron job failed:', error);
        return NextResponse.json({ success: false, error: 'Failed to refresh cookies' }, { status: 500 });
    }
}
