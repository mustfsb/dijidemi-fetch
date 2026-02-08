import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { supabase as supabaseServiceRole } from '@/lib/db/supabase';

async function verifyAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return { error: 'Server configuration error', status: 500 };
  }

  const supabase = createAdminClient();
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

  return {};
}

export async function GET() {
  const adminCheck = await verifyAdmin();
  if (adminCheck.error) {
    return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
  }

  try {
    const { data, error } = await supabaseServiceRole
      .from('ai_log')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ logs: data });
  } catch (error: any) {
    console.error('AI Logs Fetch Error:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch AI logs', 
      details: error.message 
    }, { status: 500 });
  }
}
