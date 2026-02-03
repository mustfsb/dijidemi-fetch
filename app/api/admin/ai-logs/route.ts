import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

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

  let isAdmin = user.app_metadata?.role === 'admin';

  if (!isAdmin) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role === 'admin') isAdmin = true;
  }

  if (!isAdmin) {
    return { error: 'Forbidden', status: 403 };
  }

  return { supabase };
}

export async function GET() {
  const adminCheck = await verifyAdmin();
  if (adminCheck.error) {
    return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
  }

  const { supabase } = adminCheck;

  try {
    const { data, error } = await supabase
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
