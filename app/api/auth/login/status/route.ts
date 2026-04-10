import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    return NextResponse.json({ error: 'Bu endpoint sadece local browser modunda kullanılır.' }, { status: 404 });
}
