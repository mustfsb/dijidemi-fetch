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
    if (!RateLimits.GENERAL(ip)) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const body = await request.json();
    const { user_id, external_user_id, event_type, test_id, details } = body;

    if (!event_type || !test_id) {
      return NextResponse.json({ error: 'event_type and test_id required' }, { status: 400 });
    }

    // Validate event type
    const validEvents = ['TEST_SAVED', 'ANSWER_KEY_VIEWED'];
    if (!validEvents.includes(event_type)) {
      return NextResponse.json({ error: 'Invalid event_type' }, { status: 400 });
    }

    // Get IP address (reuse from rate limiter)
    const clientIp = ip;

    // Get user ID if we have external_user_id
    let resolvedUserId = user_id;
    if (!resolvedUserId && external_user_id) {
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('external_id', external_user_id)
        .single();
      
      if (user) {
        resolvedUserId = user.id;
      }
    }

    // Insert log
    const { error } = await supabase.from('logs').insert([{
      user_id: resolvedUserId,
      event_type,
      target_id: test_id,
      ip_address: clientIp,
      details: details || {}
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
