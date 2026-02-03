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

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ users: data });
  } catch (error: any) {
    return NextResponse.json({ 
      error: 'Failed to fetch', 
      details: error.message,
      code: error.code 
    }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await verifyAdmin();
    if ('error' in auth) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { supabase } = auth;
    const body = await request.json();
    const { id, updates } = body;

    const { error } = await supabase.from("users").update(updates).eq("id", id);
    if (error) throw error;
    
    return NextResponse.json({ success: true });
  } catch(e) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
    try {
        const auth = await verifyAdmin();
        if ('error' in auth) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
    
        const { supabase } = auth;
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if(!id) return NextResponse.json({error: 'ID required'}, {status: 400});

        const { error } = await supabase.from("users").delete().eq("id", id);
        if (error) throw error;
        
        return NextResponse.json({ success: true });
    } catch(e) {
        return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
    }
}
