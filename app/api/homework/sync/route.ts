import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import cookieManager from '@/lib/cookie/cookieManager';

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    
    // 1. Fetch authentication headers from Dijidemi session
    const authHeaders = await cookieManager.getHeaders();
    const baseCookie = authHeaders['Cookie'] || '';

    let assignments: any[] = [];

    // --- DIJIDEMI FETCH LOGIC ---
    if (baseCookie.includes('TEST_TOKEN')) {
      // Mock data for testing
      assignments = [
        { id: "1001", title: "Test Ödevi 1 (Matematik)", dateRange: "20.01.2026 - 25.01.2026" },
        { id: "1002", title: "Test Ödevi 2 (Fizik)", dateRange: "21.01.2026 - 26.01.2026" },
        { id: "1003", title: "Test Ödevi 3 (Kimya)", dateRange: "22.01.2026 - 27.01.2026" }
      ];
    } else {
        // Real Dijidemi fetch
        const fullCookie = `${baseCookie}; kullaniciId = 0; soruCevap = { "0": {} }`;
        const endpoints = [
            'https://www.dijidemi.com/Ogrenci/_OdevDurum?___layout',
            'https://www.dijidemi.com/Ogrenci/OdevDurum',
        ];

        let html = '';
        let fetchSuccess = false;

        for (const url of endpoints) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Cookie': fullCookie,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html, */*; q=0.01',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Origin': 'https://www.dijidemi.com',
                        'Referer': 'https://www.dijidemi.com/Ogrenci',
                    },
                    body: ''
                });

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

    // 2. Sync to Supabase
    let count = 0;
    for (const assignment of assignments) {
      // Check for existing status to preserve it
      const { data: existing } = await supabase
        .from('homeworks')
        .select('id, status')
        .eq('homework_identifier', assignment.id)
        .maybeSingle();
      
      const saveData = {
        homework_identifier: assignment.id,
        description: `${assignment.title} (${assignment.dateRange})`,
        status: existing?.status || 'active', // Preserve existing status (Active/Deactive)
        type: 'assignment',
        updated_at: new Date().toISOString()
      };

      // UPSERT onConflict 'homework_identifier' (Requires Unique Constraint on DB)
      const { error: saveError } = await supabase
        .from('homeworks')
        .upsert(saveData, { onConflict: 'homework_identifier' });
      
      if (saveError) {
        console.error("Supabase Save Error for ID", assignment.id, ":", saveError);
      } else if (!existing) {
        // If it was newly inserted, increment count
        count++;
      }
    }

    return NextResponse.json({ success: true, count, assignments });

  } catch (error: any) {
    console.error('CRITICAL: Sync Route Error:', error);
    return NextResponse.json({ 
      error: 'Sync operation failed', 
      details: error.message 
    }, { status: 500 });
  }
}
