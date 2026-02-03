import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

// 1. Security Headers & CSP
const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline';
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

const contentSecurityPolicyHeaderValue = cspHeader
    .replace(/\s{2,}/g, ' ')
    .trim();

export async function middleware(request: NextRequest) {
    // 1. Update Supabase Session
    const { response, user } = await updateSession(request);

    // Create a direct service role client (bypasses RLS and works reliably in middleware)
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Set Security Headers
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

    // Set CSP
    response.headers.set(
        'Content-Security-Policy',
        contentSecurityPolicyHeaderValue
    );

    const { pathname } = request.nextUrl;

    // Helper to perform redirects while preserving Supabase session headers
    const redirect = (targetPath: string) => {
        const redirectResponse = NextResponse.redirect(new URL(targetPath, request.url));
        // Copy all headers from the session-updated response to the redirect response
        // This is CRITICAL for cookie persistence
        response.headers.forEach((value, name) => {
            if (name.toLowerCase() === 'set-cookie' || name.startsWith('x-')) {
                redirectResponse.headers.append(name, value);
            }
        });
        // Also ensure security headers are on the redirect
        redirectResponse.headers.set('X-Frame-Options', 'DENY');
        redirectResponse.headers.set('Content-Security-Policy', contentSecurityPolicyHeaderValue);
        return redirectResponse;
    };

    // 2. Admin Route Protection
    if (pathname.startsWith('/admin')) {
        // Exclude the login page itself to avoid redirect loops
        if (pathname === '/admin') {
            if (user) {
                let isAdmin = user.app_metadata?.role === 'admin';

                // Fallback 1: Database profile
                if (!isAdmin) {
                    const { data: profile } = await supabaseAdmin
                        .from('profiles')
                        .select('role')
                        .eq('id', user.id)
                        .single();
                    if (profile?.role === 'admin') isAdmin = true;
                }

                // Fallback 2: Custom admin table
                if (!isAdmin && user.user_metadata?.username) {
                    const { data: adminRef } = await supabaseAdmin
                        .from('admin')
                        .select('role')
                        .eq('username', user.user_metadata.username)
                        .single();
                    if (adminRef?.role === 'admin') isAdmin = true;
                }

                if (isAdmin) {
                    return redirect('/admin/dashboard');
                }
            }
            return response;
        }

        // For all other /admin/* routes
        if (!user) {
            return redirect('/admin');
        }

        let isAdmin = user.app_metadata?.role === 'admin';

        // Fallbacks
        if (!isAdmin) {
            const { data: profile } = await supabaseAdmin
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single();
            if (profile?.role === 'admin') isAdmin = true;
            
            if (!isAdmin && user.user_metadata?.username) {
                const { data: adminRef } = await supabaseAdmin
                    .from('admin')
                    .select('role')
                    .eq('username', user.user_metadata.username)
                    .single();
                if (adminRef?.role === 'admin') isAdmin = true;
            }
        }

        if (!isAdmin) {
            return redirect('/');
        }
    }

    // 3. API Protection
    if (pathname.startsWith('/api/')) {
        // Admin API routes protection
        if (pathname.startsWith('/api/admin')) {
            if (!user) {
                return new NextResponse(
                    JSON.stringify({ success: false, message: 'Unauthorized' }),
                    { status: 401, headers: { 'Content-Type': 'application/json' } }
                );
            }
            
            let isAdmin = user.app_metadata?.role === 'admin';

            if (!isAdmin) {
                const { data: profile, error: profileError } = await supabaseAdmin
                    .from('profiles')
                    .select('role')
                    .eq('id', user.id)
                    .single();
                if (profile?.role === 'admin') isAdmin = true;
                
                let adminTableData = null;
                if (!isAdmin && user.user_metadata?.username) {
                    const { data: adminRef, error: adminError } = await supabaseAdmin
                        .from('admin')
                        .select('role')
                        .eq('username', user.user_metadata.username)
                        .single();
                    adminTableData = { role: adminRef?.role, error: adminError?.message };
                    if (adminRef?.role === 'admin') isAdmin = true;
                }

                if (!isAdmin) {
                    console.error(`[MW-API] 403 Forbidden for ${user.id}. Metadata Role: ${user.app_metadata?.role}, Profile Role: ${profile?.role}`);
                    return new NextResponse(
                        JSON.stringify({ 
                            success: false, 
                            message: 'Forbidden',
                            debug: {
                                userId: user.id,
                                email: user.email,
                                app_metadata: user.app_metadata,
                                user_metadata: user.user_metadata,
                                profile_role: profile?.role,
                                profile_error: profileError?.message,
                                admin_table: adminTableData
                            }
                        }),
                        { status: 403, headers: { 'Content-Type': 'application/json' } }
                    );
                }
            }
        }

        // General API Security
        const origin = request.headers.get('origin');
        const referer = request.headers.get('referer');
        const isAllowedOrigin = !origin || origin.includes('localhost') || origin.includes('dijidemi.com');
        const isAllowedReferer = !referer || referer.includes('localhost') || referer.includes('dijidemi.com');

        if (!isAllowedOrigin && !isAllowedReferer) {
            return new NextResponse(
                JSON.stringify({ success: false, message: 'CSRF Protection: Origin/Referer not allowed' }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
        }
    }

    return response;
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
