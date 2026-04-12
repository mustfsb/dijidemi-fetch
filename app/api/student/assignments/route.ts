import { NextRequest, NextResponse } from 'next/server';
import type { Assignment, AssignmentsResponse } from '@/types';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import {
    parseAssignmentsPayload,
    readBufferedUpstreamPayload,
    requestUpstreamApi,
} from '@/lib/upstreamApi';

export const maxDuration = 25;

export async function POST(request: NextRequest): Promise<NextResponse<AssignmentsResponse | { error: string }>> {
    try {
        // Auth check
        const auth = await requireAuth(request);
        if (auth instanceof NextResponse) return auth as NextResponse<AssignmentsResponse | { error: string }>;

        // Rate limit
        const ip = getClientIp(request);
        if (!(await RateLimits.GENERAL(ip, auth.userId))) {
            return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
        }

        const response = await requestUpstreamApi({
            path: '/api/proxy',
            method: 'POST',
            json: {
                url: 'https://www.dijidemi.com/Ogrenci/_OdevDurum?___layout',
                method: 'POST',
                body: '',
            },
        });
        if (response instanceof NextResponse) return response as NextResponse<AssignmentsResponse | { error: string }>;

        if (!response.ok) {
            return NextResponse.json({ error: 'Ödev listesi alınamadı. Lütfen tekrar giriş yapın.' }, { status: 500 });
        }

        const payload = readBufferedUpstreamPayload(response);
        const payloadRecord = (
            payload
            && typeof payload === 'object'
            && !Array.isArray(payload)
        ) ? payload as Record<string, unknown> : null;
        const html = typeof payloadRecord?.body === 'string' ? payloadRecord.body : '';
        const assignments: Assignment[] = parseAssignmentsPayload(html);

        return NextResponse.json({ assignments });

    } catch (error) {
        console.error('Assignments API Error:', error);
        return NextResponse.json({ error: 'Sunucu hatası oluştu.' }, { status: 500 });
    }

}
