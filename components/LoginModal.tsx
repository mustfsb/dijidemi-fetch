'use client';

import { useState, FormEvent } from 'react';
import { LoginResponse } from '@/types';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogIn, Loader2 } from 'lucide-react';

interface LoginModalProps {
    onClose: () => void;
    onLoginSuccess: (data: LoginResponse) => void;
}

export default function LoginModal({ onClose, onLoginSuccess }: LoginModalProps) {
    const [username, setUsername] = useState<string>('');
    const [password, setPassword] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);

    const wait = (ms: number): Promise<void> => new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });

    const completeLogin = (data: LoginResponse): void => {
        if (data.user_id) {
            localStorage.setItem('user_uuid', data.user_id);
        }
        localStorage.setItem('playground_username', username);
        onLoginSuccess(data);
    };

    const pollLoginStatus = async (attemptId: string): Promise<void> => {
        const deadline = Date.now() + (1000 * 60 * 5);

        while (Date.now() < deadline) {
            const pollRes = await fetch(`/api/auth/login/status?attemptId=${encodeURIComponent(attemptId)}`, {
                credentials: 'same-origin',
            });
            const pollData: LoginResponse = await pollRes.json();

            if (pollRes.ok && pollData.status === 'ready' && pollData.success) {
                completeLogin(pollData);
                return;
            }

            if (pollData.status === 'opening_browser' || pollData.status === 'awaiting_verification') {
                setStatusMessage(
                    pollData.message
                    || 'Chrome penceresinde Dijidemi doğrulamasını tamamlayın.'
                );
                await wait(1500);
                continue;
            }

            throw new Error(pollData.error || pollData.message || 'Giriş doğrulaması başarısız.');
        }

        throw new Error('Giriş doğrulaması zaman aşımına uğradı.');
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setStatusMessage('');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            const data: LoginResponse = await res.json();

            if (res.status === 202 && data.attemptId) {
                setStatusMessage(
                    data.message
                    || 'Chrome penceresinde Dijidemi doğrulamasını tamamlayın.'
                );
                await pollLoginStatus(data.attemptId);
                return;
            }

            if (!res.ok) {
                throw new Error(data.error || 'Giriş başarısız');
            }

            completeLogin(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold text-center">
                        Giriş Yap
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-5 pt-4">
                    <div className="space-y-2">
                        <Label htmlFor="username">Kullanıcı Adı</Label>
                        <Input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            placeholder="Örn: 14308-..."
                            className="h-11"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password">Şifre</Label>
                        <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="••••••••"
                            className="h-11"
                        />
                    </div>

                    {error && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center">
                            {error}
                        </div>
                    )}

                    {!error && statusMessage && (
                        <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 text-sm text-center">
                            {statusMessage}
                        </div>
                    )}

                    <Button
                        type="submit"
                        className="w-full h-11 text-base font-semibold bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Giriş Yapılıyor...
                            </>
                        ) : (
                            <>
                                <LogIn className="w-4 h-4 mr-2" />
                                Giriş Yap
                            </>
                        )}
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
}
