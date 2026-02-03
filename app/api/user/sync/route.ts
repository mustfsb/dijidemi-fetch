import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

// Sync user to users table and log login event
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { external_id, username, action } = body;

    if (!external_id) {
      return NextResponse.json({ error: 'external_id required' }, { status: 400 });
    }

    // Get IP address
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0] || request.headers.get('x-real-ip') || 'unknown';

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('external_id', external_id)
      .single();

    let userId: string;

    if (existingUser) {
      // Update last login
      userId = existingUser.id;
      await supabase
        .from('users')
        .update({ 
          last_login_at: new Date().toISOString(),
          username: username || undefined
        })
        .eq('id', userId);
    } else {
      // Create new user
      const { data: newUser, error } = await supabase
        .from('users')
        .insert([{
          external_id,
          username: username || external_id,
          role: 'user'
        }])
        .select()
        .single();

      if (error || !newUser) {
        console.error('Error creating user:', error);
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
      }
      
      userId = newUser.id;
    }

    // Log the event
    // Log the event
    if (action) {
      const details = body.details || { source: 'dijidemi' };
      await supabase.from('logs').insert([{
        user_id: userId,
        event_type: action,
        ip_address: ip,
        details: details,
        target_id: body.target_id || null
      }]);
    }

    return NextResponse.json({ success: true, user_id: userId });

  } catch (error) {
    console.error('User sync error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
