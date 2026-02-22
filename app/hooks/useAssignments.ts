import { useState } from 'react';
import type { Assignment } from '@/types';
import { authFetch } from '@/lib/tokenManager';

export function useAssignments(
    showToast: (msg: string, type: 'success' | 'error') => void,
    refreshCookies: () => Promise<boolean>,
    setIsLoggedIn: (val: boolean) => void
) {
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingText, setLoadingText] = useState<string>('Yükleniyor...');

    const fetchAssignments = async (): Promise<void> => {
        setLoading(true);
        setLoadingText('Yükleniyor...');
        try {
            const res = await authFetch(`/api/homework/list?t=${Date.now()}`);

            if (!res.ok) {
                throw new Error('Ödev listesi yüklenemedi.');
            }

            const data = await res.json();

            if (!data.assignments || data.assignments.length === 0) {
                setAssignments([]);
            } else {
                setAssignments(data.assignments);
            }

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
