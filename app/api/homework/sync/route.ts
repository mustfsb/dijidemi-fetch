import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { supabase } from '@/lib/db/supabase';
import { getClientIp } from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { RateLimits } from '@/lib/rate-limit';

async function requireAdmin() {
  const supabaseSSR = await createAdminClient();
  const { data: { user }, error: authError } = await supabaseSSR.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const username = user.user_metadata?.username;
  if (!username) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { data: adminRef, error: adminError } = await supabase
    .from('admin')
    .select('role')
    .eq('username', username)
    .single();

  if (adminError || adminRef?.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  return { user, username };
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;

    // Rate limit
    const ip = getClientIp(request);
    if (!(await RateLimits.GENERAL(ip, admin.username))) {
        return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
    }

    const adminDb = await createAdminClient();
    
    let assignments: any[] = [];

    // --- DIJIDEMI FETCH LOGIC ---
    {
        const endpoints = [
            'https://www.dijidemi.com/Ogrenci/_OdevDurum?___layout',
            'https://www.dijidemi.com/Ogrenci/OdevDurum',
        ];

        let html = '';
        let fetchSuccess = false;

        for (const url of endpoints) {
            try {
                const response = await requestDijidemiUpstream({
                    request,
                    url,
                    method: 'POST',
                    headers: {
                        'Accept': 'text/html, */*; q=0.01',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    body: '',
                    additionalCookies: {
                        kullaniciId: '0',
                        soruCevap: JSON.stringify({ 0: {} }),
                    },
                    referrer: 'https://www.dijidemi.com/Ogrenci',
                });

                if (response instanceof NextResponse) {
                    return response;
                }

                if (response.ok) {
                    html = await response.text();
                    fetchSuccess = true;
                    break;
                }
            } catch (e) {
                console.error(`Fetch fail from ${url}:`, e);
            }
        }

        if (fetchSuccess && html) {
             const decodeEntities = (str: string): string => {
                return str
                    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)))
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");
            };
            
            // Regex for Dijidemi Homework List
            const regex1 = /<p class="font-small-1 m-0">([^<]+)<\/p>\s*<span>\s*([^<]+)\s*<\/span>[\s\S]*?data-rowid="(\d+)"/g;
            let match;
            while ((match = regex1.exec(html)) !== null) {
                assignments.push({
                    title: decodeEntities(match[1].trim()),
                    dateRange: match[2].trim(),
                    id: match[3]
                });
            }
            
            // Fallback Regex
            if (assignments.length === 0) {
                 const rowIdRegex = /data-rowid="(\d+)"/g;
                 const rowIds: string[] = [];
                 while ((match = rowIdRegex.exec(html)) !== null) {
                    if (!rowIds.includes(match[1])) rowIds.push(match[1]);
                 }
                 rowIds.forEach((id, idx) => {
                     assignments.push({ id, title: `Ödev ${idx+1}`, dateRange: '' });
                 });
            }
        }
    }

    // 2. Sync to Supabase (batched to avoid N+1 lookups/writes)
    const uniqueAssignments = Array.from(
      new Map(assignments.map((a) => [a.id, a])).values()
    );
    const identifiers = uniqueAssignments.map((a) => String(a.id));

    let count = 0;
    let failedSaves = 0;

    if (identifiers.length > 0) {
      const { data: existingRows, error: existingError } = await adminDb
        .from('homeworks')
        .select('homework_identifier, status')
        .in('homework_identifier', identifiers);

      if (existingError) {
        console.error("Supabase Existing Batch Check Error:", existingError);
      }

      const statusById = new Map<string, string>();
      for (const row of existingRows || []) {
        if (typeof row.homework_identifier === 'string' && typeof row.status === 'string' && !statusById.has(row.homework_identifier)) {
          statusById.set(row.homework_identifier, row.status);
        }
      }

      count = identifiers.filter((id) => !statusById.has(id)).length;

      const nowIso = new Date().toISOString();
      const payloadWithType = uniqueAssignments.map((assignment) => ({
        homework_identifier: String(assignment.id),
        description: `${assignment.title} (${assignment.dateRange})`,
        status: statusById.get(String(assignment.id)) || 'active',
        updated_at: nowIso,
        type: 'assignment',
      }));

      let { error: saveError } = await adminDb
        .from('homeworks')
        .upsert(payloadWithType, { onConflict: 'homework_identifier' });

      if (saveError?.code === '42703') {
        const payloadWithoutType = payloadWithType.map(({ type: _type, ...rest }) => rest);
        ({ error: saveError } = await adminDb
          .from('homeworks')
          .upsert(payloadWithoutType, { onConflict: 'homework_identifier' }));
      }

      if (saveError) {
        console.error("Supabase Batch Save Error:", saveError);
        failedSaves = uniqueAssignments.length;
      }
    }

    if (uniqueAssignments.length > 0 && failedSaves === uniqueAssignments.length) {
      return NextResponse.json(
        { success: false, error: 'Ödevler alınsa da veritabanına kaydedilemedi.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, count, assignments });

  } catch (error: any) {
    console.error('CRITICAL: Sync Route Error:', error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
    return NextResponse.json({ 
      error: 'Sync operation failed'
    }, { status: 500 });
  }
}
