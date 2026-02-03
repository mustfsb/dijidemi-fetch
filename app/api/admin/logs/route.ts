import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

async function verifyAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('MISSING ENV VARS:', { url: !!url, key: !!key });
    return { error: 'Server configuration error', status: 500 };
  }

  const supabase = createAdminClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    return { error: 'Unauthorized', status: 401 };
  }

  let isAdmin = user.app_metadata?.role === 'admin';

  if (!isAdmin) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role === 'admin') isAdmin = true;
  }

  // Final fallback to custom admin table
  if (!isAdmin && user.user_metadata?.username) {
    const { data: adminRef } = await supabase
      .from('admin')
      .select('role')
      .eq('username', user.user_metadata.username)
      .single();
    if (adminRef?.role === 'admin') isAdmin = true;
  }

  if (!isAdmin) {
    return { error: 'Forbidden', status: 403 };
  }

  return { supabase, user };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAdmin();
    if ('error' in auth) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { supabase } = auth;
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter');

    let query = supabase
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
  } catch (error: any) {
    return NextResponse.json({ 
      error: 'Failed to fetch logs', 
      details: error.message,
      code: error.code 
    }, { status: 500 });
  }
}
