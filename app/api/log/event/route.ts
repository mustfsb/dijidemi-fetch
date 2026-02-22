import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

// Log test-related events (TEST_SAVED, ANSWER_KEY_VIEWED)
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

    let body: {
      event_type?: string;
      test_id?: string;
      details?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { event_type, test_id, details } = body;

    if (!event_type || typeof event_type !== 'string' || !test_id || typeof test_id !== 'string') {
      return NextResponse.json({ error: 'event_type and test_id required' }, { status: 400 });
    }
    if (test_id.length > 128) {
      return NextResponse.json({ error: 'Invalid test_id' }, { status: 400 });
    }

    // Validate event type
    const validEvents = ['TEST_SAVED', 'ANSWER_KEY_VIEWED'];
    if (!validEvents.includes(event_type)) {
      return NextResponse.json({ error: 'Invalid event_type' }, { status: 400 });
    }

    // Get IP address (reuse from rate limiter)
    const clientIp = ip;

    // Insert log
    const { error } = await supabase.from('logs').insert([{
      user_id: auth.userId,
      event_type,
      target_id: test_id,
      ip_address: clientIp,
      details: (details && typeof details === 'object') ? details : {}
    }]);

    if (error) {
      console.error('Log insert error:', error);
      return NextResponse.json({ error: 'Failed to log event' }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Log event error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
