import { NextRequest, NextResponse } from 'next/server';
import { DIJIDEMI_SESSION_COOKIE } from '@/lib/auth';
import {
    PRIVATE_TEST_UID_COOKIE,
    revokeSignedUserToken,
} from '@/lib/private-test/device-gate';

const COOKIE_NAMES_TO_CLEAR = [
    '.ASPXAUTH',
    'ASP.NET_SessionId',
    'cf_clearance',
    'usrtkn',
    DIJIDEMI_SESSION_COOKIE,
    PRIVATE_TEST_UID_COOKIE,
    'pt_device',
];

export async function POST(request: NextRequest) {
    const signedUserCookie = request.cookies.get(PRIVATE_TEST_UID_COOKIE)?.value;
    if (signedUserCookie) {
        try {
            await revokeSignedUserToken(signedUserCookie);
        } catch (error) {
            console.error('[Logout] Failed to revoke pt_uid token:', error);
            return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
        }
    }

    const response = NextResponse.json({ success: true });
    for (const name of COOKIE_NAMES_TO_CLEAR) {
        response.cookies.set(name, '', {
            path: '/',
            expires: new Date(0),
            maxAge: 0,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
        });
    }
    return response;
}
