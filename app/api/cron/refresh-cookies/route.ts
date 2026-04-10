import { NextResponse } from 'next/server';

export async function GET() {
    return NextResponse.json(
        {
            error: 'This route is retired. Cookie refresh scheduling now runs on Render.',
        },
        { status: 410 },
    );
}
