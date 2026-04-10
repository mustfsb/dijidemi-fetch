import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

// Sync user to users table and log login event
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Rate limit
    const ip = getClientIp(request);
    if (!(await RateLimits.GENERAL(ip, auth.userId))) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    let body: {
      external_id?: string;
      action?: string;
      details?: unknown;
      target_id?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { external_id, action } = body;
    if (external_id && (typeof external_id !== 'string' || external_id.length > 128)) {
      return NextResponse.json({ error: 'invalid external_id' }, { status: 400 });
    }
    if (action && (typeof action !== 'string' || action.length > 64 || !/^[A-Z0-9_]+$/.test(action))) {
      return NextResponse.json({ error: 'invalid action' }, { status: 400 });
    }

    // Get IP address (reuse from rate limit or extract again for logging)
    const clientIp = ip;
    const userId = auth.userId;
    const now = new Date().toISOString();
    const normalizedExternalId = typeof external_id === 'string' ? external_id.trim() : '';

    if (external_id && !normalizedExternalId) {
      return NextResponse.json({ error: 'invalid external_id' }, { status: 400 });
    }

    if (normalizedExternalId) {
      const { data: conflictingUser, error: conflictError } = await supabase
        .from('users')
        .select('id')
        .eq('external_id', normalizedExternalId)
        .neq('id', userId)
        .maybeSingle();

      if (conflictError) {
        console.error('External ID conflict check failed:', conflictError);
        return NextResponse.json({ error: 'Failed to validate external_id' }, { status: 500 });
      }

      if (conflictingUser) {
        return NextResponse.json({ error: 'external_id already in use' }, { status: 409 });
      }
    }

    // Check if authenticated user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (existingUser) {
      // Update last login
      await supabase
        .from('users')
        .update({ 
          last_login_at: now,
          external_id: normalizedExternalId || undefined,
          updated_at: now,
        })
        .eq('id', userId);
    } else {
      if (!normalizedExternalId) {
        return NextResponse.json({ error: 'external_id required for first sync' }, { status: 400 });
      }
      // Create new user
      const { data: newUser, error } = await supabase
        .from('users')
        .insert([{
          id: userId,
          external_id: normalizedExternalId,
          username: normalizedExternalId,
          role: 'user',
          last_login_at: now,
          updated_at: now,
        }])
        .select()
        .single();

      if (error || !newUser) {
        console.error('Error creating user:', error);
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
      }
      if (newUser.id !== userId) {
        return NextResponse.json({ error: 'Identity mismatch' }, { status: 403 });
      }
    }

    // Log the event
    if (action) {
      const details = (body.details && typeof body.details === 'object')
        ? body.details
        : { source: 'dijidemi' };
      await supabase.from('logs').insert([{
        user_id: userId,
        event_type: action,
        ip_address: clientIp,
        details: details,
        target_id: typeof body.target_id === 'string' ? body.target_id : null
      }]);
    }

    return NextResponse.json({ success: true, user_id: userId });

  } catch (error) {
    console.error('User sync error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
