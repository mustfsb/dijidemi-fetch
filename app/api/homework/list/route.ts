import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth, getClientIp } from '@/lib/auth';
import { RateLimits } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function parseAssignmentDescription(description: string | null | undefined, type?: string) {
  const text = (description || '').trim();
  if (!text) {
    return { title: '', dateRange: '' };
  }

  // New KTT format
  if (text.startsWith('Başlık:')) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const titleLine = lines[0] || '';
    const title = titleLine.replace(/^Başlık:\s*/i, '').trim() || '';

    const dateLine = lines.find(l => /tarih/i.test(l));
    const dateRange = dateLine
      ? dateLine.replace(/^-\s*/,'').replace(/^.*?:\s*/, '').trim()
      : '';

    return { title, dateRange };
  }

  // Legacy assignment format: "Title (Date)"
  if (type !== 'ktt') {
    const legacyTitle = text.split(' (')[0] || text;
    const legacyDate = text.match(/\((.*?)\)/)?.[1] || '';
    return { title: legacyTitle.trim(), dateRange: legacyDate };
  }

  // Fallback for plain KTT description
  const firstLine = text.split('\n')[0] || text;
  return { title: firstLine.trim(), dateRange: '' };
}

export async function GET(request: NextRequest) {
  // Auth check
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // Rate limit
  const ip = getClientIp(request);
  if (!(await RateLimits.GENERAL(ip, auth.userId))) {
      return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('homeworks')
      .select('homework_identifier, description, status, type, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Map to Assignment type format for compatibility
    const assignments = (data || []).map(h => {
      // Derive type: DB column if exists, otherwise infer from description format
      const type = h.type || ((h.description || '').startsWith('Başlık:') ? 'ktt' : 'assignment');
      return {
        ...(parseAssignmentDescription(h.description, type)),
        id: h.homework_identifier,
        link: `https://www.dijidemi.com/Ogrenci/Odev?id=${h.homework_identifier}`,
        status: h.status,
        type,
      };
    });

    return NextResponse.json({ success: true, assignments });
  } catch (error) {
    console.error('Homework List Error:', error);
    return NextResponse.json({ error: 'Failed to fetch homeworks' }, { status: 500 });
  }
}
