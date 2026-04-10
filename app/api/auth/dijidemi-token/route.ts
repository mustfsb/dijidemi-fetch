import { NextRequest, NextResponse } from 'next/server';
import {
    requireUserIdentity,
    setDijidemiSessionCookie,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/dijidemi-token
 *
 * Refreshes the signed app session token and stores it as an httpOnly cookie.
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await requireUserIdentity(request);
        if (auth instanceof NextResponse) return auth;

        const response = NextResponse.json({
            success: true,
            updated_at: new Date().toISOString(),
        });
        response.headers.set('Cache-Control', 'no-store');

        if (!setDijidemiSessionCookie(response, auth.userId)) {
            return NextResponse.json(
                { error: 'Token oluşturulamadı (sunucu ayarı eksik).' },
                { status: 500 }
            );
        }
        return response;

    } catch (err) {
        console.error('[dijidemi-token] Unexpected error:', err);
        return NextResponse.json(
            { error: 'Sunucu hatası.' },
            { status: 500 }
        );
    }
}
