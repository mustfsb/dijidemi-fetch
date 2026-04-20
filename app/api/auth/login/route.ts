import { NextRequest, NextResponse } from 'next/server';
import {
    getClientIp,
    isLocalBrowserMode,
    setDijidemiSessionCookie,
} from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';
import {
    PRIVATE_TEST_COOKIE_MAX_AGE,
    PRIVATE_TEST_UID_COOKIE,
    signUserId,
} from '@/lib/private-test/device-gate';
import { syncDijidemiUserToDatabase } from '@/lib/auth/syncDijidemiUser';
import { localDijidemiBrowserManager } from '@/lib/dijidemi/localBrowserManager';

interface LoginBody {
    username: string;
    password: string;
}

interface LoginApiResponse {
    success?: boolean;
    data?: unknown;
    user_id?: string;
    status?: 'awaiting_verification';
    attemptId?: string;
    message?: string;
    error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<LoginApiResponse>> {
    try {
        // Rate limit login attempts
        const ip = getClientIp(request);
        const loginScope = request.headers.get('user-agent') || 'unknown-agent';
        if (!(await RateLimits.LOGIN(ip, loginScope))) {
            return NextResponse.json({ error: 'Çok fazla giriş denemesi. Lütfen bekleyin.' }, { status: 429 });
        }

        let body: LoginBody;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const { username, password } = body;

        const trimmedUsername = username?.trim();
        const trimmedPassword = password?.trim();

        if (!trimmedUsername || !trimmedPassword) {
            return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
        }
        if (trimmedUsername.length > 128 || trimmedPassword.length > 256) {
            return NextResponse.json({ error: 'Username or password too long' }, { status: 400 });
        }

        if (isLocalBrowserMode()) {
            const attempt = localDijidemiBrowserManager.startLoginAttempt({
                username: trimmedUsername,
                password: trimmedPassword,
            });

            return NextResponse.json({
                status: 'awaiting_verification',
                attemptId: attempt.attemptId,
                message: attempt.message,
            }, { status: 202 });
        }

        // Production: validate against configured credentials, then issue app session cookies.
        const expectedUsername = process.env.DIJIDEMI_USERNAME?.trim();
        const expectedPassword = process.env.DIJIDEMI_PASSWORD?.trim();

        if (!expectedUsername || !expectedPassword) {
            return NextResponse.json({ error: 'Sunucu kullanıcı bilgileri yapılandırılmamış.' }, { status: 500 });
        }

        if (trimmedUsername !== expectedUsername || trimmedPassword !== expectedPassword) {
            return NextResponse.json({ error: 'Kullanıcı adı veya şifre hatalı.' }, { status: 401 });
        }

        // --- USER SYNC: Check & Create ---
        const userId = await syncDijidemiUserToDatabase(trimmedUsername, request);
        if (!userId) {
            return NextResponse.json({ error: 'Kullanıcı kaydı senkronize edilemedi.' }, { status: 500 });
        }

        const response = NextResponse.json({
            success: true,
            data: { authenticated: true },
            user_id: userId,
        });
        response.headers.set('Cache-Control', 'no-store');

        const signedUserId = await signUserId(userId);
        if (!signedUserId) {
            return NextResponse.json({ error: 'Sunucu kimlik imzalama ayarı eksik.' }, { status: 500 });
        }
        response.cookies.set(PRIVATE_TEST_UID_COOKIE, signedUserId, {
            httpOnly: true,
            path: '/',
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: PRIVATE_TEST_COOKIE_MAX_AGE,
        });

        if (!setDijidemiSessionCookie(response, userId)) {
            return NextResponse.json({ error: 'Sunucu oturum ayarı eksik.' }, { status: 500 });
        }

        return response;

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? (error.stack ?? '') : '';
        console.error('Login Error:', errorMsg.substring(0, 500));
        if (errorStack) console.error('Login Stack:', errorStack.substring(0, 1000));
        return NextResponse.json({ error: 'Giriş sırasında bir hata oluştu.' }, { status: 500 });
    }
}
