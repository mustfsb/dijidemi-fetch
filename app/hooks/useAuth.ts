import { useState, useEffect } from 'react';
import { fetchAndStoreToken, clearStoredToken, isTokenStale, markTokenFresh } from '@/lib/tokenManager';

export function useAuth(showToast: (msg: string, type: 'success' | 'error') => void) {
    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [showLoginModal, setShowLoginModal] = useState<boolean>(false);

    useEffect(() => {
        (async () => {
            const savedLoginState = localStorage.getItem('isLoggedIn');
            if (savedLoginState !== 'true') return;

            if (isTokenStale()) {
                const success = await fetchAndStoreToken();
                if (!success) {
                    console.warn('[useAuth] Token refresh failed on mount');
                }
            }

            setIsLoggedIn(true);
        })();
    }, []);

    const handleLoginSuccess = async (): Promise<void> => {
        setIsLoggedIn(true);
        setShowLoginModal(false);
        localStorage.setItem('isLoggedIn', 'true');
        markTokenFresh();
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
        clearStoredToken();
        showToast('Çıkış yapıldı', 'success');
    };

    return {
        isLoggedIn,
        setIsLoggedIn,
        showLoginModal,
        setShowLoginModal,
        handleLoginSuccess,
        handleLogout,
    };
}
