import { useState } from 'react';
import type { Assignment } from '@/types';
import { authFetch } from '@/lib/tokenManager';

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
            const res = await authFetch('/api/homework/list');

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Ödev listesi yüklenemedi.');
            }

            const data = await res.json();

            setAssignments(Array.isArray(data.assignments) ? data.assignments : []);

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
        fetchAssignments
    };
}
