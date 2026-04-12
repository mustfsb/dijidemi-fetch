import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { createClient } from '@supabase/supabase-js'
import {
    getPrivateTestEnrollmentState,
    PRIVATE_TEST_COOKIE_MAX_AGE,
    PRIVATE_TEST_DEVICE_COOKIE,
    PRIVATE_TEST_UID_COOKIE,
    verifyOrEnrollBinding,
    verifySignedUserId,
} from '@/lib/private-test/device-gate'

function buildContentSecurityPolicy(_nonce: string): string {
    const scriptSources = [`'self'`, `'unsafe-inline'`];
    if (process.env.NODE_ENV === 'development') {
        scriptSources.push(`'unsafe-eval'`);
    }

    return [
        `default-src 'self'`,
        `script-src ${scriptSources.join(' ')}`,
        `style-src 'self' 'unsafe-inline'`,
        `img-src 'self' blob: data: https://*.dijidemi.com https://yayin.etapyayinlari.com https://*.supabase.co https://mofugpfhwbgcunkfkrhc.supabase.co`,
        `media-src 'self' https://video.yayincilik.net blob:`,
        `font-src 'self' data: https://fonts.gstatic.com`,
        `connect-src 'self' https://generativelanguage.googleapis.com https://*.supabase.co https://mofugpfhwbgcunkfkrhc.supabase.co`,
        `object-src 'none'`,
        `base-uri 'self'`,
        `form-action 'self'`,
        `frame-ancestors 'none'`,
        `block-all-mixed-content`,
        `upgrade-insecure-requests`,
    ].join('; ');
}

export async function middleware(request: NextRequest) {
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);

    // 1. Session Güncelleme
    const { response, user } = await updateSession(request, requestHeaders);
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
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    response.headers.set('Content-Security-Policy', buildContentSecurityPolicy(nonce));
    response.headers.set('x-nonce', nonce);
    if (process.env.NODE_ENV === 'production') {
        response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

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
        response.headers.set('Cache-Control', 'no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('Vary', 'Origin, Cookie');

        const method = request.method.toUpperCase();
        if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
            const lengthHeader = request.headers.get('content-length');
            const contentLength = Number.parseInt(lengthHeader || '0', 10);
            const MAX_API_BODY_BYTES = 256 * 1024; // 256 KB
            if (Number.isFinite(contentLength) && contentLength > MAX_API_BODY_BYTES) {
                return new NextResponse(
                    JSON.stringify({ success: false, message: 'Payload too large' }),
                    { status: 413, headers: { 'Content-Type': 'application/json' } }
                );
            }
        }

        const origin = request.headers.get('origin') || '';
        const requestOrigin = request.nextUrl.origin;
        
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
        
        // Always allow same-origin API calls for the current deployment host
        const isSameOrigin = !!origin && origin === requestOrigin;

        const isAllowed = ALLOWED_ORIGINS.has(origin) || isLocalDev || isSameOrigin;

        if (!isAllowed) {
            console.error(`[Middleware] Blocked API request from Origin: ${origin} (Expected: ${requestOrigin})`);
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

    // 2.5 Private-Test cihaz/tarayıcı kilidi
    const isPrivateTestPage = pathname === '/private-test' || pathname.startsWith('/private-test/');

    if (isPrivateTestPage) {
        const signedUserIdCookie = request.cookies.get(PRIVATE_TEST_UID_COOKIE)?.value;
        const cookieUserId = await verifySignedUserId(signedUserIdCookie);
        const resolvedUserId = cookieUserId;

        if (!resolvedUserId) {
            return redirect('/?private_test_error=missing_or_invalid_pt_uid');
        }

        let allowAutoEnroll = false;
        if (isPrivateTestPage) {
            const enrollment = await getPrivateTestEnrollmentState();
            if (enrollment.status === 'misconfigured') {
                return redirect('/?private_test_error=missing_private_test_secret');
            }
            if (enrollment.status === 'error') {
                return redirect('/?private_test_error=enrollment_control_error');
            }
            allowAutoEnroll = enrollment.isOpen;
        }

        const gate = await verifyOrEnrollBinding({
            userId: resolvedUserId,
            userAgent: request.headers.get('user-agent') || '',
            deviceToken: request.cookies.get(PRIVATE_TEST_DEVICE_COOKIE)?.value || null,
            autoEnroll: allowAutoEnroll,
        });

        if (gate.status !== 'ok' && gate.status !== 'enrolled') {
            if (gate.reason === 'binding_not_found' && !allowAutoEnroll) {
                return redirect('/?private_test_error=enrollment_closed');
            }
            return redirect(`/?private_test_error=${encodeURIComponent(gate.reason)}`);
        }

        if (gate.cookieToken) {
            response.cookies.set(PRIVATE_TEST_DEVICE_COOKIE, gate.cookieToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: PRIVATE_TEST_COOKIE_MAX_AGE,
            });
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
