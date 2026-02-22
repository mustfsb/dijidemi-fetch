import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { supabase as supabaseServiceRole } from '@/lib/db/supabase';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

async function verifyAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('MISSING ENV VARS:', { url: !!url, key: !!key });
    return { error: 'Server configuration error', status: 500 };
  }

  // SSR client — reads session cookies to identify the caller
  const supabaseSSR = await createAdminClient();
  const { data: { user }, error: authError } = await supabaseSSR.auth.getUser();
  
  if (authError || !user) {
    return { error: 'Unauthorized', status: 401 };
  }

  // Authoritative check: the admin table is the single source of truth
  // Never trust JWT app_metadata alone — it can be stale
  // Use the service-role client for the DB query to bypass RLS
  let isAdmin = false;
  const username = user.user_metadata?.username;
  if (username) {
    const { data: adminRef } = await supabaseServiceRole
      .from('admin')
      .select('role')
      .eq('username', username)
      .single();
    if (adminRef?.role === 'admin') isAdmin = true;
  }

  if (!isAdmin) {
    return { error: 'Forbidden', status: 403 };
  }

  return { user };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAdmin();
    if ('error' in auth) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { data, error } = await supabaseServiceRole
      .from("users")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ users: data });
  } catch (error) {
    console.error('[Admin Users GET] Failed:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch'
    }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await verifyAdmin();
    if ('error' in auth) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let body: { id?: string; updates?: Record<string, unknown> };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { id, updates } = body;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    if (!updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Invalid updates payload' }, { status: 400 });
    }

    const allowedFields = new Set(['nickname_credential', 'role', 'full_name', 'username', 'external_id']);
    const sanitizedUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.has(key)) {
        sanitizedUpdates[key] = value;
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return NextResponse.json({ error: 'No allowed update fields provided' }, { status: 400 });
    }

    // 1. Update the users table (service-role client bypasses RLS)
    const { error } = await supabaseServiceRole.from("users").update(sanitizedUpdates).eq("id", id);
    if (error) throw error;

    // 2. Sync the admin table if role changed
    if (sanitizedUpdates.role) {
      // Look up the user's username to use as the admin table key
      const { data: userRecord } = await supabaseServiceRole
        .from('users')
        .select('username, external_id')
        .eq('id', id)
        .single();

      const adminUsername = userRecord?.username || userRecord?.external_id;

      if (adminUsername) {
        const { data: existingAdmin } = await supabaseServiceRole
          .from('admin')
          .select('password')
          .eq('username', adminUsername)
          .maybeSingle();

        const existingPassword = typeof existingAdmin?.password === 'string'
          ? existingAdmin.password.trim()
          : '';
        const safePassword = existingPassword || await bcrypt.hash(randomUUID(), 12);

        // Upsert: insert if not exists, update role if exists — never delete
        const { error: upsertError } = await supabaseServiceRole
          .from('admin')
          .upsert(
            { username: adminUsername, password: safePassword, role: sanitizedUpdates.role },
            { onConflict: 'username' }
          );
        if (upsertError) {
          console.error('[Admin Sync] Failed to upsert admin table:', upsertError);
        } else {
          console.log(`[Admin Sync] Set '${adminUsername}' role to '${String(sanitizedUpdates.role)}'`);
        }
      }
    }
    
    return NextResponse.json({ success: true });
  } catch (e) {
      console.error('[Admin Users PATCH] Failed:', e);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
    try {
        const auth = await verifyAdmin();
        if ('error' in auth) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
    
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if(!id || id.length > 128) return NextResponse.json({error: 'ID required'}, {status: 400});

        const { error } = await supabaseServiceRole.from("users").delete().eq("id", id);
        if (error) throw error;
        
        return NextResponse.json({ success: true });
    } catch(e) {
        return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
    }
}
