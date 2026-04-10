import { NextRequest, NextResponse } from 'next/server';
import {
    isLocalBrowserMode,
    setDijidemiSessionCookie,
    setDijidemiUpstreamCookies,
} from '@/lib/auth';
import { syncDijidemiUserToDatabase } from '@/lib/auth/syncDijidemiUser';
import {
    PRIVATE_TEST_COOKIE_MAX_AGE,
    PRIVATE_TEST_UID_COOKIE,
    signUserId,
} from '@/lib/private-test/device-gate';
import { localDijidemiBrowserManager } from '@/lib/dijidemi/localBrowserManager';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    if (!isLocalBrowserMode()) {
        return NextResponse.json({ error: 'Bu endpoint sadece local browser modunda kullanılır.' }, { status: 404 });
    }

    const attemptId = new URL(request.url).searchParams.get('attemptId')?.trim() || '';
    if (!attemptId) {
        return NextResponse.json({ error: 'attemptId gerekli.' }, { status: 400 });
    }

    const attempt = localDijidemiBrowserManager.getAttemptSnapshot(attemptId);
    if (!attempt) {
        return NextResponse.json({ error: 'Login attempt bulunamadı.' }, { status: 404 });
    }

    if (attempt.status === 'opening_browser' || attempt.status === 'awaiting_verification') {
        return NextResponse.json({
            status: attempt.status,
            attemptId: attempt.attemptId,
            message: attempt.message,
        });
    }

    if (attempt.status === 'failed') {
        const status = (attempt.error || '').toLowerCase().includes('hatalı')
            || (attempt.error || '').toLowerCase().includes('yanlış')
            ? 401
            : 503;

        return NextResponse.json({
            status: 'failed',
            attemptId: attempt.attemptId,
            error: attempt.error || attempt.message,
        }, { status });
    }

    const userId = await syncDijidemiUserToDatabase(attempt.username, request);
    if (!userId) {
        return NextResponse.json({ error: 'Kullanıcı kaydı senkronize edilemedi.' }, { status: 500 });
    }

    localDijidemiBrowserManager.rememberUser(userId, attempt.username);

    const response = NextResponse.json({
        success: true,
        status: 'ready',
        data: { authenticated: true },
        user_id: userId,
    });
    response.headers.set('Cache-Control', 'no-store');

    const upstreamCookies = await localDijidemiBrowserManager.getAttemptCookies(attemptId);
    if (upstreamCookies) {
        setDijidemiUpstreamCookies(response, upstreamCookies);
    }

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
}
