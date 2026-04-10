import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { supabase as supabaseServiceRole } from '@/lib/db/supabase';

async function verifyAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('MISSING ENV VARS:', { url: !!url, key: !!key });
    return { error: 'Server configuration error', status: 500 };
  }

  const supabase = await createAdminClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    return { error: 'Unauthorized', status: 401 };
  }

  // Authoritative check: admin table only, via service-role client
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

    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter');

    let query = supabaseServiceRole
      .from("logs")
      .select("*, users(username, full_name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (filter && filter !== "ALL") {
      query = query.eq("event_type", filter);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ logs: data });
  } catch (error) {
    console.error('[Admin Logs GET] Failed:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch logs'
    }, { status: 500 });
  }
}
