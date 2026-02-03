import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

// Log test-related events (TEST_SAVED, ANSWER_KEY_VIEWED)
export async function POST(request: NextRequest) {
  try {
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

    // Get IP address
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0] || request.headers.get('x-real-ip') || 'unknown';

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
      ip_address: ip,
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
