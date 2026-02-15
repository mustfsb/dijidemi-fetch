import { NextRequest, NextResponse } from 'next/server';

/**
 * Lightweight authentication check for API routes.
 * Verifies that the request has a valid login cookie (.ASPXAUTH).
 * Returns user info or a 401 response.
 */
export function requireAuth(request: NextRequest): { userId: string } | NextResponse {
    // Check for the auth cookie set during login from upstream dijidemi.com
    const authCookie = request.cookies.get('.ASPXAUTH')?.value;

    if (!authCookie) {
        // Debug: Log all browser cookie names to help diagnose issues
        const allCookies = request.cookies.getAll().map(c => c.name);
        console.error('[Auth] .ASPXAUTH cookie missing. Available cookies:', allCookies);
        return NextResponse.json(
            { error: 'Oturum açmanız gerekiyor.' },
            { status: 401 }
        );
    }

    // Resolve user ID from cookie or header
    const userId = request.cookies.get('user_uuid')?.value
        || request.headers.get('x-user-id')
        || 'unknown';

    return { userId };
}

/**
 * Extract client IP from request headers.
 */
export function getClientIp(request: NextRequest): string {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'unknown';
}
