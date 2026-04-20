import { NextRequest, NextResponse } from 'next/server';
import type { Assignment, AssignmentsResponse } from '@/types';
import { getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import {
    parseAssignmentsPayload,
    readBufferedUpstreamPayload,
    requestUpstreamApi,
} from '@/lib/upstreamApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

export async function GET(
    request: NextRequest
): Promise<NextResponse<AssignmentsResponse | { error: string }>> {
    try {
        const ip = getClientIp(request);
        if (!(await RateLimits.GENERAL(ip))) {
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

        if (response instanceof NextResponse) {
            return response as NextResponse<AssignmentsResponse | { error: string }>;
        }

        if (!response.ok) {
            return NextResponse.json(
                { error: 'Ödev listesi upstream API üzerinden alınamadı.' },
                { status: response.status }
            );
        }

        const payload = readBufferedUpstreamPayload(response);
        const payloadRecord = (
            payload
            && typeof payload === 'object'
            && !Array.isArray(payload)
        ) ? payload as Record<string, unknown> : null;
        const html = typeof payloadRecord?.body === 'string' ? payloadRecord.body : '';

        const assignments: Assignment[] = parseAssignmentsPayload(html).map((assignment) => ({
            ...assignment,
            link: '',
            status: 'active',
            type: assignment.type || 'assignment',
        }));

        return NextResponse.json({ success: true, assignments });
    } catch (error) {
        console.error('Homework List Error:', error);
        return NextResponse.json({ error: 'Failed to fetch homeworks' }, { status: 500 });
    }
}
