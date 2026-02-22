import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Rate limit
    const ip = getClientIp(request);
    if (!RateLimits.GENERAL(ip, auth.userId)) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    let body: { event_type?: string; details?: unknown; target_id?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { event_type, details, target_id } = body;

    // Validate
    if (!event_type || typeof event_type !== 'string') {
      return NextResponse.json({ error: 'Missing event_type' }, { status: 400 });
    }
    if (event_type.length > 64 || !/^[A-Z0-9_]+$/.test(event_type)) {
      return NextResponse.json({ error: 'Invalid event_type format' }, { status: 400 });
    }
    if (target_id && (typeof target_id !== 'string' || target_id.length > 128)) {
      return NextResponse.json({ error: 'Invalid target_id' }, { status: 400 });
    }

    // Insert Log
    const { error } = await supabase.from('logs').insert([{
      user_id: auth.userId,
      event_type,
      details: (details && typeof details === 'object') ? details : {},
      target_id: target_id || null,
      ip_address: ip
    }]);

    if (error) {
      console.error('Log Insert Error:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Log API Error:', error);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}
