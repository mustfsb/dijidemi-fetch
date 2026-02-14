import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { createClient } from '@supabase/supabase-js'

const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ''};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://*.dijidemi.com https://yayin.etapyayinlari.com https://*.supabase.co https://mofugpfhwbgcunkfkrhc.supabase.co; 
    media-src 'self' https://video.yayincilik.net blob:;
    font-src 'self' data: https://fonts.gstatic.com;
    connect-src 'self' https://generativelanguage.googleapis.com https://*.supabase.co https://mofugpfhwbgcunkfkrhc.supabase.co;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    block-all-mixed-content;
    upgrade-insecure-requests;
`;

const contentSecurityPolicyHeaderValue = cspHeader.replace(/\s{2,}/g, ' ').trim();

export async function middleware(request: NextRequest) {
    // 1. Session Güncelleme
    const { response, user } = await updateSession(request);
    const { pathname } = request.nextUrl;

    // Supabase Admin Client (Yetki kontrolleri için)
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Güvenlik Başlıkları
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Content-Security-Policy', contentSecurityPolicyHeaderValue);

    const redirect = (targetPath: string) => {
        const redirectResponse = NextResponse.redirect(new URL(targetPath, request.url));
        response.headers.forEach((value, name) => {
            if (name.toLowerCase() === 'set-cookie' || name.startsWith('x-')) {
                redirectResponse.headers.append(name, value);
            }
        });
        return redirectResponse;
    };

    // 2. API Koruması ve CSRF Kontrolü
    if (pathname.startsWith('/api/')) {
        const origin = request.headers.get('origin') || '';
        
        // Strict origin allowlist
        const ALLOWED_ORIGINS = new Set([
            '',  // Same-origin requests (no Origin header)
            'https://www.dijidemi.com',
            'https://dijidemi.com',
            'https://diji-fetch.netlify.app',
        ]);

        // In development, allow any localhost/127.0.0.1 port
        const isLocalDev = process.env.NODE_ENV === 'development' 
            && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'));

        const isAllowed = ALLOWED_ORIGINS.has(origin) || isLocalDev;

        if (!isAllowed) {
            console.error(`[Middleware] Blocked API request from Origin: ${origin}`);
            return new NextResponse(
                JSON.stringify({ success: false, message: 'CSRF Protection: Origin not allowed' }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Admin API Koruma
        if (pathname.startsWith('/api/admin')) {
            if (!user) return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
            
            // Always check the DB — never trust JWT app_metadata alone (it can be stale)
            const isAdmin = await checkDbAdmin(supabaseAdmin, user);
            if (!isAdmin) return new NextResponse(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
        }
    }

    // 3. Admin Sayfa Koruması
    if (pathname.startsWith('/admin')) {
        if (pathname === '/admin') {
            if (user && (await checkDbAdmin(supabaseAdmin, user))) {
                return redirect('/admin/dashboard');
            }
            return response;
        }

        if (!user) return redirect('/admin');
        
        const isAdmin = await checkDbAdmin(supabaseAdmin, user);
        if (!isAdmin) return redirect('/');
    }

    return response;
}

async function checkDbAdmin(client: any, user: any) {
    // Authoritative check: the admin table is the single source of truth
    const username = user.user_metadata?.username;
    if (username) {
        const { data: adminRef } = await client.from('admin').select('role').eq('username', username).single();
        if (adminRef?.role === 'admin') return true;
    }
    return false;
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
