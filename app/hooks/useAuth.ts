import { useState, useEffect } from 'react';

export function useAuth(showToast: (msg: string, type: 'success' | 'error') => void) {
    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

    useEffect(() => {
        const savedLoginState = localStorage.getItem('isLoggedIn');
        if (savedLoginState === 'true') {
            setIsLoggedIn(true);
        }
    }, []);

    const handleLoginSuccess = (data?: any) => {
        setIsLoggedIn(true);
        setShowLoginModal(false);
        localStorage.setItem('isLoggedIn', 'true');
        // user_id is now stored by LoginModal from the login response
    };

    const handleLogout = async () => {
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
        showToast('Çıkış yapıldı', 'success');
    };

    const refreshCookies = async (): Promise<boolean> => {
        setIsRefreshing(true);
        try {
            const res = await fetch('/api/status?force=true');
            const data = await res.json();
            if (data.status === 'valid') {
                showToast('Cookie yenilendi!', 'success');
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
