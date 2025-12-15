'use client';

import { useEffect, useState } from 'react';

export default function CookieStatus() {
    const [status, setStatus] = useState<'valid' | 'refreshing' | 'error' | 'loading'>('loading');

    useEffect(() => {
        const checkStatus = async () => {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                setStatus(data.status);
            } catch {
                setStatus('error');
            }
        };

        checkStatus();
        // Poll every 10 seconds if refreshing
        const interval = setInterval(() => {
            if (status === 'refreshing' || status === 'loading') {
                checkStatus();
            }
        }, 10000);

        return () => clearInterval(interval);
    }, [status]);

    if (status === 'refreshing') {
        return (
            <div className="fixed bottom-4 right-4 bg-black/80 backdrop-blur-md border border-white/10 text-white px-4 py-2 rounded-full flex items-center gap-3 z-50 shadow-2xl animate-in slide-in-from-bottom-5">
                <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                <span className="text-sm font-medium">Cookie'ler yenileniyor...</span>
            </div>
        );
    }

    return null;
}
