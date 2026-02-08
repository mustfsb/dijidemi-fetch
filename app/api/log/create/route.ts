import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, event_type, details, target_id } = body;

    // Validate
    if (!user_id || !event_type) {
      return NextResponse.json({ error: 'Missing user_id or event_type' }, { status: 400 });
    }

    // Insert Log
    const { error } = await supabase.from('logs').insert([{
      user_id,
      event_type,
      details: details || {},
      target_id: target_id || null,
      ip_address: request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
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
