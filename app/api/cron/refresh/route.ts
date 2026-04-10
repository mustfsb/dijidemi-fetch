import { NextResponse } from 'next/server';

export const maxDuration = 60; // Render'in uyanmasi ve tarayici acmasi uzun surebilir
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // Vercel Cron'dan geldigini dogrula (Opsiyonel ama guvenlik icin iyi olur)
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pythonApiUrl = process.env.DIJIDEMI_PYTHON_API_URL || "https://dijidemi-proxy.onrender.com";
    
    // Render'daki Python API'nin "/api/refresh-cookies" endpoint'ini tetikliyoruz
    const res = await fetch(`${pythonApiUrl}/api/refresh-cookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store'
    });

    const data = await res.json();
    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error("Cron Error:", error);
    return NextResponse.json({ error: 'Failed to trigger refresh' }, { status: 500 });
  }
}