import { useState } from 'react';
import type { Assignment } from '@/types';

const UPSTREAM_BASE =
    process.env.NEXT_PUBLIC_UPSTREAM_API_BASE_URL?.replace(/\/$/, '') ||
    'https://diji-fetch.duckdns.org';
const UPSTREAM_TOKEN =
    process.env.NEXT_PUBLIC_UPSTREAM_API_TOKEN || 'aBcD';

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function parseAssignmentsFromHtml(html: string): Assignment[] {
    const assignments: Assignment[] = [];
    const primaryPattern = /<p class="font-small-1 m-0">([^<]+)<\/p>\s*<span>\s*([^<]+)\s*<\/span>[\s\S]*?data-rowid="(\d+)"/g;

    let match: RegExpExecArray | null;
    while ((match = primaryPattern.exec(html)) !== null) {
        assignments.push({
            id: match[3],
            title: decodeHtmlEntities(match[1].trim()).replace(/\s+/g, ' '),
            dateRange: decodeHtmlEntities(match[2].trim()).replace(/\s+/g, ' '),
            link: '',
            type: 'assignment',
        });
    }

    if (assignments.length > 0) return assignments;

    const rowIdPattern = /data-rowid="(\d+)"/g;
    const seenIds = new Set<string>();
    while ((match = rowIdPattern.exec(html)) !== null) {
        const id = match[1];
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        assignments.push({
            id,
            title: `Ödev ${seenIds.size}`,
            dateRange: '',
            link: '',
            type: 'assignment',
        });
    }

    return assignments;
}

export function useAssignments() {
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingText, setLoadingText] = useState<string>('Yükleniyor...');

    const fetchAssignments = async (): Promise<void> => {
        setLoading(true);
        setLoadingText('Yükleniyor...');
        setError(null);
        try {
            const res = await fetch(`${UPSTREAM_BASE}/api/proxy`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${UPSTREAM_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: 'https://www.dijidemi.com/Ogrenci/_OdevDurum?___layout',
                    method: 'POST',
                    body: '',
                }),
            });

            if (!res.ok) throw new Error('Ödev listesi yüklenemedi.');

            const data = await res.json();
            const html = typeof data.body === 'string' ? data.body : '';
            const parsed = parseAssignmentsFromHtml(html);
            setAssignments(parsed);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Bilinmeyen hata');
        } finally {
            setLoading(false);
        }
    };

    return {
        assignments,
        loading,
        loadingText,
        error,
        fetchAssignments,
    };
}
