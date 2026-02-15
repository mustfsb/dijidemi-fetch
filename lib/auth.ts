import { NextRequest, NextResponse } from 'next/server';

/**
 * Lightweight authentication check for API routes.
 * 
 * Checks for auth token in this order:
 * 1. `x-dijidemi-token` header (preferred — set by client from localStorage)
 * 2. `.ASPXAUTH` cookie (legacy fallback — set during login via Set-Cookie)
 * 
 * This dual approach ensures compatibility both locally and on Netlify/serverless.
 */
export function requireAuth(request: NextRequest): { userId: string } | NextResponse {
    // 1. Check for token in custom header (localStorage-based approach)
    const headerToken = request.headers.get('x-dijidemi-token');
    
    // 2. Fallback: Check for the auth cookie (legacy browser cookie approach)
    const cookieToken = request.cookies.get('.ASPXAUTH')?.value;
    
    const authToken = headerToken || cookieToken;

    if (!authToken) {
        // Debug: Log available info to help diagnose
        const allCookies = request.cookies.getAll().map(c => c.name);
        const hasHeader = !!headerToken;
        console.error(`[Auth] No auth token found. Header present: ${hasHeader}. Available cookies: [${allCookies.join(', ')}]`);
        return NextResponse.json(
            { error: 'Oturum açmanız gerekiyor.' },
            { status: 401 }
        );
    }

    // Resolve user ID from multiple sources
    const userId = request.headers.get('x-user-id')
        || request.cookies.get('user_uuid')?.value
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
