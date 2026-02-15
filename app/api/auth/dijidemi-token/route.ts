import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/dijidemi-token
 * 
 * Returns the current Dijidemi session cookie value from Supabase.
 * The client stores this in localStorage and sends it as x-dijidemi-token header.
 * This eliminates reliance on browser cookies (which fail on Netlify).
 */
export async function GET() {
    try {
        const { data, error } = await supabase
            .from('auth_cookies')
            .select('cookie_json, updated_at')
            .order('updated_at', { ascending: false })
            .limit(1)
            .single();

        if (error || !data) {
            console.error('[dijidemi-token] Failed to fetch from Supabase:', error);
            return NextResponse.json(
                { error: 'Cookie bilgisi alınamadı.' },
                { status: 500 }
            );
        }

        const cookieJson = typeof data.cookie_json === 'string'
            ? JSON.parse(data.cookie_json)
            : data.cookie_json;

        // Build a token string that represents the session  
        // We use ASP.NET_SessionId as the primary token since it's the most important
        const sessionId = cookieJson['ASP.NET_SessionId'] || '';
        const cfClearance = cookieJson['cf_clearance'] || '';
        const usrtkn = cookieJson['usrtkn'] || '';

        if (!sessionId) {
            return NextResponse.json(
                { error: 'Geçerli oturum bulunamadı. Cookie yenilenmeli.' },
                { status: 503 }
            );
        }

        // Return a composite token the client will store
        const token = Buffer.from(JSON.stringify({
            s: sessionId,
            c: cfClearance,
            u: usrtkn,
        })).toString('base64');

        return NextResponse.json({
            success: true,
            token,
            updated_at: data.updated_at,
        });

    } catch (err) {
        console.error('[dijidemi-token] Unexpected error:', err);
        return NextResponse.json(
            { error: 'Sunucu hatası.' },
            { status: 500 }
        );
    }
}
