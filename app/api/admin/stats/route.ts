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

    const [usersRes, logsRes, homeworksRes, recentLogsRes] = await Promise.all([
      supabaseServiceRole.from("users").select("*", { count: "exact", head: true }),
      supabaseServiceRole.from("logs").select("*", { count: "exact", head: true }),
      supabaseServiceRole.from("homeworks").select("*", { count: "exact", head: true }).eq("status", "active"),
      supabaseServiceRole.from("logs").select("*, users(username)").order("created_at", { ascending: false }).limit(5),
    ]);

    // Today's logins
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: todayLoginsCount } = await supabaseServiceRole
      .from("logs")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "LOGIN")
      .gte("created_at", today.toISOString());

    return NextResponse.json({
      stats: {
        totalUsers: usersRes.count || 0,
        todayLogins: todayLoginsCount || 0,
        activeHomeworks: homeworksRes.count || 0,
        totalLogs: logsRes.count || 0,
      },
      recentLogs: recentLogsRes.data || []
    });

  } catch (error) {
    console.error('Admin Stats Error:', error);
    return NextResponse.json({ 
      error: 'Internal Error'
    }, { status: 500 });
  }
}
