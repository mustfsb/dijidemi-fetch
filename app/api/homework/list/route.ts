import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Auth check
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // Rate limit
  const ip = getClientIp(request);
  if (!RateLimits.GENERAL(ip)) {
      return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
  }
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('homeworks')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Map to Assignment type format for compatibility
    const assignments = data.map(h => ({
      id: h.homework_identifier,
      title: h.description?.split(' (')[0] || h.description || '',
      dateRange: h.description?.match(/\((.*?)\)/)?.[1] || '',
      link: `https://www.dijidemi.com/Ogrenci/Odev?id=${h.homework_identifier}`,
      status: h.status,
      type: h.type
    }));

    return NextResponse.json({ success: true, assignments });
  } catch (error) {
    console.error('Homework List Error:', error);
    return NextResponse.json({ error: 'Failed to fetch homeworks' }, { status: 500 });
  }
}
