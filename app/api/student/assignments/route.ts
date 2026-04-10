import { NextRequest, NextResponse } from 'next/server';
import type { Assignment, AssignmentsResponse } from '@/types';
import {
    requireAuth,
    getClientIp,
} from '@/lib/auth';
import { requestDijidemiUpstream } from '@/lib/dijidemi/upstream';
import { RateLimits } from '@/lib/rate-limit';

export const maxDuration = 25;

export async function POST(request: NextRequest): Promise<NextResponse<AssignmentsResponse | { error: string }>> {
    try {
        // Auth check
        const auth = await requireAuth(request);
        if (auth instanceof NextResponse) return auth as NextResponse<AssignmentsResponse | { error: string }>;

        // Rate limit
        const ip = getClientIp(request);
        if (!(await RateLimits.GENERAL(ip, auth.userId))) {
            return NextResponse.json({ error: 'Çok fazla istek. Lütfen bekleyin.' }, { status: 429 });
        }

        // Try multiple endpoints to fetch assignments
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
                    userId: auth.userId,
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
                if (response instanceof NextResponse) return response as NextResponse<AssignmentsResponse | { error: string }>;

                if (response.ok) {
                    html = await response.text();
                    fetchSuccess = true;
                    break;
                }
            } catch (e) {
                console.error(`Failed to fetch from ${url}: `, e);
            }
        }

        if (!fetchSuccess || !html) {
            return NextResponse.json({ error: 'Ödev listesi alınamadı. Lütfen tekrar giriş yapın.' }, { status: 500 });
        }

        // Helper to decode HTML entities (e.g. &#214; -> Ö)
        const decodeEntities = (str: string): string => {
            return str
                .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)))
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
        };

        const assignments: Assignment[] = [];

        // Multiple regex patterns to handle different HTML structures
        const patterns = [
            // Pattern 1: Original format
            /<p class="font-small-1 m-0">([^<]+)<\/p>\s*<span>\s*([^<]+)\s*<\/span>[\s\S]*?data-rowid="(\d+)"/g,
            // Pattern 2: Alternative with different class
            /<p[^>]*>([^<]+)<\/p>\s*<span[^>]*>\s*([^<]+)\s*<\/span>[\s\S]*?data-rowid="(\d+)"/g,
            // Pattern 3: Look for data-rowid first, then extract nearby text
            /data-rowid="(\d+)"[\s\S]*?<(?:h\d|p|span)[^>]*>([^<]{5,})<\/(?:h\d|p|span)>/g,
        ];

        // Try first pattern
        let match: RegExpExecArray | null;
        const regex1 = patterns[0];
        while ((match = regex1.exec(html)) !== null) {
            const rawTitle = match[1].trim();
            const date = match[2].trim();
            const cleanTitle = decodeEntities(rawTitle).replace(/\s+/g, ' ');

            if (cleanTitle.length > 2) {
                assignments.push({
                    title: cleanTitle,
                    dateRange: date,
                    id: match[3],
                    link: `https://www.dijidemi.com/Ogrenci/Odev?id=${match[3]}`
                });
            }
        }

        // If no results, try looking for odev-card structure
        if (assignments.length === 0) {
            // Look for div blocks with data-rowid
            const rowIdRegex = /data-rowid="(\d+)"/g;
            const rowIds: string[] = [];

            while ((match = rowIdRegex.exec(html)) !== null) {
                if (!rowIds.includes(match[1])) {
                    rowIds.push(match[1]);
                }
            }

            // For each rowId, create a basic assignment
            rowIds.forEach((id, index) => {
                assignments.push({
                    title: `Ödev ${index + 1}`,
                    dateRange: '',
                    id: id,
                    link: `https://www.dijidemi.com/Ogrenci/Odev?id=${id}`
                });
            });
        }

        return NextResponse.json({ assignments });

    } catch (error) {
        console.error('Assignments API Error:', error);
        return NextResponse.json({ error: 'Sunucu hatası oluştu.' }, { status: 500 });
    }

}
