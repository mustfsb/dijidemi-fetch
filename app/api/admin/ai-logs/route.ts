import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { supabase as supabaseServiceRole } from '@/lib/db/supabase';

async function verifyAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
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

  return {};
}

// UUID v4 pattern for detecting UUID-style usernames
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const adminCheck = await verifyAdmin();
  if (adminCheck.error) {
    return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
  }

  // Pagination support
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  try {
    // Fetch paginated logs — exclude heavy fields from list view
    const { data, error, count } = await supabaseServiceRole
      .from('ai_log')
      .select('id, created_at, username, session_title, title, user_prompt, ai_response, sender', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Resolve UUID usernames to dijidemi usernames
    if (data && data.length > 0) {
      const uuidUsernames = [...new Set(
        data
          .map(log => log.username)
          .filter(u => u && UUID_REGEX.test(u))
      )];

      if (uuidUsernames.length > 0) {
        const { data: users } = await supabaseServiceRole
          .from('users')
          .select('id, username')
          .in('id', uuidUsernames);

        if (users && users.length > 0) {
          const uuidToUsername = new Map(users.map(u => [u.id, u.username]));
          for (const log of data) {
            if (log.username && UUID_REGEX.test(log.username)) {
              const resolved = uuidToUsername.get(log.username);
              if (resolved) {
                (log as any).resolved_username = resolved;
              }
            }
          }
        }
      }
    }

    return NextResponse.json({ 
      logs: data,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: count ? Math.ceil(count / limit) : 0
      }
    });
  } catch (error: any) {
    console.error('AI Logs Fetch Error:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch AI logs'
    }, { status: 500 });
  }
}
