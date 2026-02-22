import { useState, useEffect } from 'react';
import { fetchAndStoreToken, clearStoredToken, isTokenStale, getStoredToken } from '@/lib/tokenManager';

export function useAuth(showToast: (msg: string, type: 'success' | 'error') => void) {
    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

    useEffect(() => {
        // Use an async IIFE so we can await the token fetch before marking as logged in.
        // This prevents the race condition where fetchAssignments() fires before the token
        // is stored in localStorage, causing a 401 on first page load.
        (async () => {
            const savedLoginState = localStorage.getItem('isLoggedIn');
            if (savedLoginState !== 'true') return;

            // If token is missing or stale, fetch it first — then set logged in.
            const token = getStoredToken();
            if (!token || isTokenStale()) {
                const success = await fetchAndStoreToken();
                if (!success) {
                    console.warn('[useAuth] Token refresh failed on mount');
                }
            }

            // Token is now guaranteed to be in localStorage (or was already there).
            setIsLoggedIn(true);
        })();
    }, []);

    const handleLoginSuccess = async (data?: any) => {
        setIsLoggedIn(true);
        setShowLoginModal(false);
        localStorage.setItem('isLoggedIn', 'true');

        // Immediately fetch and store the dijidemi token from Supabase
        const tokenSuccess = await fetchAndStoreToken();
        if (tokenSuccess) {
            console.log('[useAuth] Dijidemi token stored in localStorage');
        } else {
            console.warn('[useAuth] Failed to fetch dijidemi token after login');
        }
    };

    const handleLogout = async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (e) {
            console.error('Logout cookie clear failed:', e);
        }

        // Log logout event
        const userId = localStorage.getItem('user_uuid');
        if (userId) {
            try {
                await fetch('/api/log/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        user_id: userId,
                        event_type: 'LOGOUT'
                    }),
                });
            } catch (e) { console.error(e); }
        }

        setIsLoggedIn(false);
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('user_uuid');
        // Clear the dijidemi token
        clearStoredToken();
        showToast('Çıkış yapıldı', 'success');
    };

    const refreshCookies = async (): Promise<boolean> => {
        setIsRefreshing(true);
        try {
            const res = await fetch('/api/status?force=true');
            const data = await res.json();
            if (data.status === 'valid') {
                // After server refreshes cookies, also update our local token
                const tokenSuccess = await fetchAndStoreToken();
                if (tokenSuccess) {
                    showToast('Cookie yenilendi!', 'success');
                } else {
                    showToast('Cookie yenilendi, ancak token alınamadı.', 'error');
                }
                return true;
            } else {
                showToast('Cookie yenilenemedi.', 'error');
            }
        } catch (e) {
            console.error('Refresh error:', e);
            showToast('Cookie yenileme hatası.', 'error');
        } finally {
            setIsRefreshing(false);
        }
        return false;
    };

    return {
        isLoggedIn,
        setIsLoggedIn,
        showLoginModal,
        setShowLoginModal,
        isRefreshing,
        handleLoginSuccess,
        handleLogout,
        refreshCookies,
    };
}
