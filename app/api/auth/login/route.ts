import { NextRequest, NextResponse } from 'next/server';
import cookieManager from '@/lib/cookie/cookieManager';

interface LoginBody {
    username: string;
    password: string;
}

interface LoginApiResponse {
    success?: boolean;
    data?: unknown;
    error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<LoginApiResponse>> {
    try {
        const body: LoginBody = await request.json();
        const { username, password } = body;

        if (!username || !password) {
            return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
        }

        // 1. Initial Login Request to get cookies and authentication
        const loginUrl = `https://www.dijidemi.com/Login/UserLogin?vs=1395.0022726223199&userName=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&fromCms=0&rememberMe=true`;

        // We need to fetch with a standard User-Agent and headers to mimic a browser
        const loginResponse = await fetch(loginUrl, {
            method: 'GET', // Based on Request 4 example provided by user
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'X-Requested-With': 'XMLHttpRequest',
                // Important: mimic the Referer
                'Referer': 'https://www.dijidemi.com/Login',
            }
        });

        if (!loginResponse.ok) {
            return NextResponse.json({ error: 'Login failed upstream' }, { status: loginResponse.status });
        }

        const loginData = await loginResponse.json();

        // Check if login was actually successful based on response body
        // The example doesn't show the response body, but usually false or null indicates failure.
        // We'll assume if we got cookies, it's a good sign, but let's check the data if possible.
        // For now, we return the data to the client to verify.

        const setCookieHeader = loginResponse.headers.get('set-cookie');

        // Return success with the cookies
        // We will manually parse and set the cookies on the Next.js response so the browser stores them
        // The client (browser) will then send these cookies back to our API on subsequent requests

        const response = NextResponse.json({ success: true, data: loginData });

        if (setCookieHeader) {
            // fast-and-loose cookie split (handling multiple Set-Cookie headers is tricky in fetch API in some envs)
            // But Next.js/Node fetch usually combines them or gives an iterator.
            // Let's iterate if possible, or handle the string.
            // Note: node-fetch might modify how it returns headers. 
            // In Next.js App Router, headers.getSetCookie() is available in newer versions 
            // or headers.get('set-cookie') might return a comma-separated list which is bad for dates.

            // safer approach for Next.js middleware/Edge:
            const cookies = loginResponse.headers.getSetCookie
                ? loginResponse.headers.getSetCookie()
                : [loginResponse.headers.get('set-cookie')];

            cookies.forEach((cookieString: string | null) => {
                if (cookieString) {
                    // Simple parsing to get name and value. 
                    // Real parsing is complex, but we mainly want to pass them through.
                    // However, we can't easily "pass through" raw Set-Cookie strings invalidly in NextResponse. 
                    // We should let the client handle it? No, client is browser, requests are mostly CORS or Proxy.
                    // Since we represent the backend for the frontend, we should set these cookies on our domain.
                    // The browser will scope them to localhost:3000 (or wherever we are).

                    const parts = cookieString.split(';');
                    const firstPart = parts[0];
                    const [name, value] = firstPart.split('=');

                    if (name && value) {
                        response.cookies.set(name.trim(), value.trim(), {
                            httpOnly: true, // Force httpOnly for security
                            path: '/',
                            secure: process.env.NODE_ENV === 'production',
                            sameSite: 'lax',
                        });
                    }
                }
            });
        }

        return response;

    } catch (error) {
        console.error('Login Error:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
