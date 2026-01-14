import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 1. Security Headers & CSP
const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://*.dijidemi.com https://yayin.etapyayinlari.com; 
    media-src 'self' https://video.yayincilik.net blob:;
    font-src 'self' data: https://fonts.gstatic.com;
    connect-src 'self' https://generativelanguage.googleapis.com;
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

export function middleware(request: NextRequest) {
    const response = NextResponse.next();

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

    // 2. API Protection (Prevent external scraping/fetching)
    if (request.nextUrl.pathname.startsWith('/api/')) {
        const origin = request.headers.get('origin');
        const referer = request.headers.get('referer');
        const host = request.headers.get('host'); // e.g. localhost:3000

        // If we can't determine host, we're being conservative, but we should be careful not to block internal Node/Vercel calls.
        // Usually host header is present.
        if (!host) {
            // Let's allow if host is missing? Or block? 
            // Ideally block if we are strict.
            // But let's check if we can validate.
            // If host is missing, origin/referer check is hard.
        }

        let isAllowed = false;

        // Check if origin matches host
        if (host && origin) {
            if (origin.includes(host)) {
                isAllowed = true;
            }
        }
        // If no origin, check referer
        else if (host && referer) {
            if (referer.includes(host)) {
                isAllowed = true;
            }
        }
        // If neither, fallback check.
        else {
            // In browser, referer is usually there. 
            // In severe privacy mode, it might be stripped.
            // But same-origin fetches usually have it.
        }


        if (!isAllowed) {
            // Return 403
            return new NextResponse(
                JSON.stringify({ success: false, message: 'Unauthorized access source' }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
        }
    }

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
}
