import { NextResponse } from 'next/server';
import { PRIVATE_TEST_UID_COOKIE } from '@/lib/private-test/device-gate';

const COOKIE_NAMES_TO_CLEAR = [
    '.ASPXAUTH',
    'ASP.NET_SessionId',
    'cf_clearance',
    'usrtkn',
    PRIVATE_TEST_UID_COOKIE,
    'pt_device',
];

export async function POST() {
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
