import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

// Sync user to users table and log login event
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
    const { external_id, username, action } = body;

    if (!external_id) {
      return NextResponse.json({ error: 'external_id required' }, { status: 400 });
    }

    // Get IP address (reuse from rate limit or extract again for logging)
    const clientIp = ip;

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
        ip_address: clientIp,
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
