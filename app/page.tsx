'use client';

import { useState, useEffect, useMemo, useCallback, ChangeEvent } from 'react';
import { useTheme } from 'next-themes';
import booksData from './data/books.json';
import LoginModal from '@/components/LoginModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Moon, Sun, ArrowLeft, Settings, LogIn, BookOpen, ClipboardList, ChevronRight } from 'lucide-react';
import type {
    Book,
    BooksBySubject,
    Test,
    TestData,
    Assignment,
    Video,
    ToastState,
    UserAnswers,
    AssignmentContext,
    LoginResponse
} from '@/types';

// --- Helper Functions ---
const groupBooksBySubject = (books: Book[]): BooksBySubject => {
    const subjectGroups: BooksBySubject = {};
    const subjectRegex = /(TÜRKÇE|MATEMATİK|KİMYA|FİZİK|GEOMETRİ|BİYOLOJİ)/i;
    books.forEach(book => {
        const match = book.name.match(subjectRegex);
        let subject = 'Diğer';
        if (match) {
            subject = match[1].toUpperCase();
            if (['MATEMATİK', 'GEOMETRİ'].includes(subject)) {
                if (book.name.includes('AYT MATEMATİK')) subject = 'AYT MATEMATİK';
                else if (book.name.includes('TYT MATEMATİK')) subject = 'TYT MATEMATİK';
                else if (book.name.includes('YKS GEOMETRİ')) subject = 'GEOMETRİ';
            }
            if (subject === 'TÜRKÇE' && book.name.includes('TYT TÜRKÇE')) subject = 'TYT TÜRKÇE';
            if (['KİMYA', 'FİZİK', 'BİYOLOJİ'].includes(subject)) subject = `YKS ${subject}`;
        }
        if (!subjectGroups[subject]) subjectGroups[subject] = [];
        subjectGroups[subject].push(book);
    });
    return subjectGroups;
};

type ActiveTab = 'books' | 'assignments' | 'test-view';

export default function Home() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [loadingText, setLoadingText] = useState<string>('Yükleniyor...');
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

    const [loading, setLoading] = useState<boolean>(false);
    const [data, setData] = useState<TestData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [videos, setVideos] = useState<Video[]>([]);
    const [videoStatus, setVideoStatus] = useState<string | null>(null);

    // Auth State
    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<ActiveTab>('books');
    const [assignments, setAssignments] = useState<Assignment[]>([]);

    // Book Navigation
    const [books] = useState<Book[]>(booksData as Book[]);
    const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
    const [selectedBook, setSelectedBook] = useState<Book | null>(null);
    const [bookTests, setBookTests] = useState<Test[]>([]);
    const [loadingTests, setLoadingTests] = useState<boolean>(false);
    const [selectedTest, setSelectedTest] = useState<Test | null>(null);

    // Context
    const [assignmentContext, setAssignmentContext] = useState<AssignmentContext | null>(null);

    // Answering & Toast
    const [userAnswers, setUserAnswers] = useState<UserAnswers>({});
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' });

    // Settings
    const [showSettings, setShowSettings] = useState<boolean>(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

    // Scroll state for Navbar animation
    const [scrolled, setScrolled] = useState(false);

    // Scroll Listener
    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 50);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Hydration fix
    useEffect(() => {
        setMounted(true);
    }, []);

    const showToast = (message: string, type: 'success' | 'error' = 'success'): void => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast(prev => ({ ...prev, show: false })), 2000);
    };

    const groupedBooks = useMemo(() => groupBooksBySubject(books), [books]);
    const subjects = useMemo(() => Object.keys(groupedBooks).sort(), [groupedBooks]);
    const currentBooks = selectedSubject ? groupedBooks[selectedSubject] : [];

    // Close mobile menu on desktop resize
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 1024 && mobileMenuOpen) {
                setMobileMenuOpen(false);
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [mobileMenuOpen]);

    const refreshCookies = async (): Promise<boolean> => {
        setIsRefreshing(true);
        setLoadingText('Cookie yenileniyor/çekiliyor... Lütfen bekleyin.');
        setLoading(true);
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
            setLoadingText('Yükleniyor...');
        }
        return false;
    };

    const fetchAssignments = async (retry: boolean = true): Promise<void> => {
        setLoading(true);
        setLoadingText('Yükleniyor...');
        try {
            const res = await fetch('/api/student/assignments', { method: 'POST' });

            // If unauthorized or error status
            if (!res.ok) {
                if (res.status === 401 || res.status === 500) {
                    if (retry) {
                        const refreshed = await refreshCookies();
                        if (refreshed) {
                            return fetchAssignments(false);
                        }
                    }
                    if (res.status === 401) {
                        setIsLoggedIn(false);
                        localStorage.removeItem('isLoggedIn');
                        throw new Error('Oturum sonlandı.');
                    }
                }
                throw new Error('Ödev listesi yüklenemedi.');
            }

            const da = await res.json();

            // If assignments are empty, it might be due to stale cookies
            if (!da.assignments || da.assignments.length === 0) {
                if (retry) {
                    console.log('Assignments empty, attempting cookie refresh...');
                    const refreshed = await refreshCookies();
                    if (refreshed) {
                        return fetchAssignments(false);
                    }
                }
                // If still empty after refresh, set empty list
                setAssignments([]);
            } else {
                setAssignments(da.assignments);
            }

        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        }
        finally { setLoading(false); }
    };

    // Load login state from localStorage on mount
    useEffect(() => {
        const savedLoginState = localStorage.getItem('isLoggedIn');
        if (savedLoginState === 'true') {
            setIsLoggedIn(true);
            setActiveTab('assignments');
            fetchAssignments();
        }
    }, []);

    const handleLoginSuccess = (): void => {
        setIsLoggedIn(true);
        setShowLoginModal(false);
        setActiveTab('assignments');
        localStorage.setItem('isLoggedIn', 'true');
        fetchAssignments();
    };

    const loadTest = async (tId: string, context: AssignmentContext | null = null): Promise<void> => {
        setLoading(true);
        setError(null);
        setData(null);
        setVideos([]);
        setUserAnswers({});
        setVideoStatus('Hazırlanıyor...');
        setAssignmentContext(context);

        try {
            const res = await fetch(`/api/proxy?testId=${tId}`);
            if (!res.ok) throw new Error('Test verisi alınamadı');
            const json: TestData = await res.json();
            setData(json);

            const count = json.SoruSayisi || 40;
            for (let i = 1; i <= count; i++) {
                setVideoStatus(`${i}. soru çekiliyor...`);
                fetch(`/api/video?testId=${tId}&soruId=${i}`)
                    .then(r => r.json())
                    .then(d => {
                        if (d.success && d.videoUrl) {
                            setVideos(p => [...p, { q: i, url: d.videoUrl }].sort((a, b) => a.q - b.q));
                        }
                    }).catch(() => { });
            }
            setVideoStatus('Tamamlandı');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
            setVideoStatus('Hata');
        } finally {
            setLoading(false);
        }
    };

    const handleBookClick = async (book: Book): Promise<void> => {
        setSelectedBook(book);
        setLoadingTests(true);
        try {
            const res = await fetch('/api/book-tests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: book.id })
            });
            const d = await res.json();
            if (d.success) setBookTests(d.tests);
        } catch (e) {
            setError('Testler yüklenemedi');
        }
        finally { setLoadingTests(false); }
    };

    const handleAssignmentClick = (asgn: Assignment): void => {
        setSelectedTest({ id: asgn.id, name: asgn.title });
        loadTest(asgn.id, { odevId: asgn.id });
        setActiveTab('test-view');
    };

    const saveAnswers = async (): Promise<void> => {
        if (!selectedTest) return;
        setIsSaving(true);
        try {
            const res = await fetch('/api/student/save-answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    testId: selectedTest.id,
                    answers: userAnswers,
                    totalQuestions: data?.SoruSayisi || 40,
                    odevId: assignmentContext?.odevId || 0,
                })
            });
            if (!res.ok) throw new Error('Hata');
            showToast('✅ Cevaplar kaydedildi!', 'success');
        } catch (e) {
            showToast('❌ Kayıt başarısız.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleLogout = () => {
        setIsLoggedIn(false);
        localStorage.removeItem('isLoggedIn');
        setActiveTab('books');
        setShowSettings(false);
        showToast('Çıkış yapıldı', 'success');
    };

    if (!mounted) {
        return null;
    }

    return (
        <div className="min-h-screen flex flex-col bg-background">
            {/* Login Modal */}
            {showLoginModal && (
                <LoginModal
                    onClose={() => setShowLoginModal(false)}
                    onLoginSuccess={handleLoginSuccess}
                />
            )}

            {/* Header */}
            <header className={`header ${scrolled ? 'header-scrolled' : ''}`}>
                <div
                    className="logo"
                    onClick={() => {
                        setActiveTab('books');
                        setSelectedTest(null);
                        setSelectedSubject(null);
                        setSelectedBook(null);
                    }}
                >
                    DIJI-FETCH
                </div>

                {/* Desktop Nav - hidden on mobile, visible on lg+ (1024px) */}
                <nav className="nav hidden lg:flex">
                    {isLoggedIn ? (
                        <>
                            <button
                                className={`nav-btn ${activeTab === 'assignments' ? 'active' : ''}`}
                                onClick={() => setActiveTab('assignments')}
                            >
                                <ClipboardList className="w-4 h-4 mr-2 inline" />
                                Ödevlerim
                            </button>
                            <button
                                className={`nav-btn ${activeTab === 'books' ? 'active' : ''}`}
                                onClick={() => setActiveTab('books')}
                            >
                                <BookOpen className="w-4 h-4 mr-2 inline" />
                                Kitaplar
                            </button>
                            <button
                                className="nav-btn"
                                onClick={() => setShowSettings(true)}
                            >
                                <Settings className="w-4 h-4 mr-2 inline" />
                                Ayarlar
                            </button>
                        </>
                    ) : (
                        <Button
                            onClick={() => setShowLoginModal(true)}
                            className="login-btn"
                        >
                            <LogIn className="w-4 h-4 mr-2" />
                            Giriş Yap
                        </Button>
                    )}

                    <button
                        className="theme-toggle"
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        aria-label="Tema değiştir"
                    >
                        {theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                    </button>
                </nav>

                {/* Mobile Menu Button */}
                <button
                    className="mobile-menu-btn"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    aria-label="Menü"
                >
                    {mobileMenuOpen ? '✕' : '☰'}
                </button>
            </header>

            {/* Mobile Nav */}
            {mobileMenuOpen && (
                <div className="mobile-nav">
                    {isLoggedIn ? (
                        <>
                            <button onClick={() => { setActiveTab('assignments'); setMobileMenuOpen(false); }}>
                                <ClipboardList className="w-4 h-4 mr-2 inline" />
                                Ödevlerim
                            </button>
                            <button onClick={() => { setActiveTab('books'); setMobileMenuOpen(false); }}>
                                <BookOpen className="w-4 h-4 mr-2 inline" />
                                Kitaplar
                            </button>
                            <button onClick={() => { setShowSettings(true); setMobileMenuOpen(false); }}>
                                <Settings className="w-4 h-4 mr-2 inline" />
                                Ayarlar
                            </button>
                        </>
                    ) : (
                        <button onClick={() => { setShowLoginModal(true); setMobileMenuOpen(false); }}>
                            <LogIn className="w-4 h-4 mr-2 inline" />
                            Giriş Yap
                        </button>
                    )}
                    <button onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setMobileMenuOpen(false); }}>
                        {theme === 'dark' ? <Moon className="w-4 h-4 mr-2 inline" /> : <Sun className="w-4 h-4 mr-2 inline" />}
                        {theme === 'dark' ? 'Koyu Mod' : 'Açık Mod'}
                    </button>
                </div>
            )}

            {/* Settings Dialog */}
            <Dialog open={showSettings} onOpenChange={setShowSettings}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Settings className="w-5 h-5" />
                            Ayarlar
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        {/* Theme Toggle */}
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label>Tema</Label>
                                <p className="text-sm" style={{ color: 'var(--color-muted-foreground)' }}>
                                    {theme === 'dark' ? 'Koyu mod aktif' : 'Açık mod aktif'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Sun className="w-4 h-4" style={{ color: 'var(--color-muted-foreground)' }} />
                                <Switch
                                    checked={theme === 'dark'}
                                    onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                                />
                                <Moon className="w-4 h-4" style={{ color: 'var(--color-muted-foreground)' }} />
                            </div>
                        </div>

                        <Separator />

                        {/* Logout */}
                        {isLoggedIn && (
                            <Button
                                variant="destructive"
                                className="w-full"
                                onClick={handleLogout}
                            >
                                Çıkış Yap
                            </Button>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Main Content */}
            <main className="main">
                {error && <div className="error-banner">{error}</div>}

                {/* Books View */}
                {activeTab === 'books' && !selectedTest && (
                    !selectedSubject ? (
                        <div>
                            <h1 className="section-title">Dersler</h1>
                            <div className="grid-cards">
                                {subjects.map(s => (
                                    <Card
                                        key={s}
                                        className="subject-card group"
                                        onClick={() => setSelectedSubject(s)}
                                    >
                                        <h3 className="group-hover:text-accent transition-colors">{s}</h3>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    ) : !selectedBook ? (
                        <div>
                            <button className="back-btn" onClick={() => setSelectedSubject(null)}>
                                <ArrowLeft className="w-4 h-4" />
                                Derslere Dön
                            </button>
                            <h1 className="section-title">{selectedSubject}</h1>
                            <div className="grid-cards">
                                {currentBooks.map(b => (
                                    <Card
                                        key={b.id}
                                        className="subject-card group"
                                        onClick={() => handleBookClick(b)}
                                    >
                                        <h3 className="text-sm group-hover:text-accent transition-colors">{b.name}</h3>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div>
                            <button className="back-btn" onClick={() => setSelectedBook(null)}>
                                <ArrowLeft className="w-4 h-4" />
                                Kitaplara Dön
                            </button>
                            <h1 className="section-title">{selectedBook.name}</h1>
                            {loadingTests ? (
                                <div className="loader">Yükleniyor...</div>
                            ) : (
                                <div className="test-list-wrapper">
                                    <div className="test-list-scroll">
                                        {bookTests.map((test, index) => (
                                            <div
                                                key={test.id}
                                                className="test-list-item group"
                                                onClick={() => {
                                                    setSelectedTest(test);
                                                    loadTest(test.id);
                                                }}
                                            >
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    <span className="test-number">{index + 1}</span>
                                                    <span className="truncate">{test.name}</span>
                                                </div>
                                                <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-muted-foreground" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                )}

                {/* Assignments View */}
                {activeTab === 'assignments' && !selectedTest && (
                    <div>
                        <h1 className="section-title">Ödevlerim</h1>
                        {loading && <div className="loader">{loadingText}</div>}
                        {assignments.length > 0 ? (
                            <div className="grid-cards">
                                {assignments.map(a => (
                                    <Card
                                        key={a.id}
                                        className="assignment-card group cursor-pointer"
                                        onClick={() => handleAssignmentClick(a)}
                                    >
                                        <CardHeader className="p-0 pb-2">
                                            <div className="flex justify-between items-center">
                                                <span className="badge">ÖDEV</span>
                                                <span className="date">{a.dateRange}</span>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="p-0">
                                            <h3 className="font-medium leading-snug">{a.title}</h3>
                                        </CardContent>
                                        <CardFooter className="p-0 pt-4 mt-auto">
                                            <span className="text-sm font-semibold text-accent flex items-center gap-1 group-hover:gap-2 transition-all">
                                                Testi Çöz
                                                <ChevronRight className="w-4 h-4" />
                                            </span>
                                        </CardFooter>
                                    </Card>
                                ))}
                            </div>
                        ) : !loading && (
                            <p className="empty-msg">Aktif ödev bulunamadı.</p>
                        )}
                    </div>
                )}

                {/* Test View */}
                {(selectedTest || activeTab === 'test-view') && selectedTest && (
                    <div>
                        {/* Toolbar */}
                        <div className="flex flex-col gap-4 mb-8 pb-6 border-b border-border">
                            <button
                                className="back-btn"
                                onClick={() => {
                                    setSelectedTest(null);
                                    setVideos([]);
                                    setActiveTab(isLoggedIn && assignmentContext ? 'assignments' : 'books');
                                }}
                            >
                                <ArrowLeft className="w-4 h-4" />
                                Geri Dön
                            </button>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                <h1 className="text-2xl font-bold">{selectedTest.name}</h1>
                                {isLoggedIn && (
                                    <Button
                                        className="save-btn"
                                        onClick={saveAnswers}
                                        disabled={isSaving}
                                    >
                                        {isSaving ? 'Kaydediliyor...' : 'Cevapları Kaydet'}
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Split Layout */}
                        <div className="split-layout">
                            {/* Answer Panel */}
                            {data && (
                                <div className="panel">
                                    <div className="panel-header">Cevap Anahtarı</div>
                                    <div className="answers-grid">
                                        {data.CevapAnahtari.split('').map((ans, i) => (
                                            <div key={i} className="answer-item">
                                                <div className="q-num">{i + 1}</div>
                                                <div className="q-val">{ans}</div>
                                                {isLoggedIn && (
                                                    <select
                                                        value={userAnswers[i + 1] || ''}
                                                        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                                            setUserAnswers({ ...userAnswers, [i + 1]: e.target.value })
                                                        }
                                                    >
                                                        <option value="">-</option>
                                                        {['A', 'B', 'C', 'D', 'E'].map(o => (
                                                            <option key={o} value={o}>{o}</option>
                                                        ))}
                                                    </select>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Video Panel */}
                            <div className="panel">
                                <div className="panel-header">
                                    Video Çözümler
                                    <span className={`status-indicator ${videoStatus === 'Tamamlandı' ? 'success' :
                                        videoStatus === 'Hata' ? 'error' : 'loading'
                                        }`}>
                                        <span className="status-dot" />
                                        {videoStatus}
                                    </span>
                                </div>
                                <div className="video-list">
                                    {videos.map((v, index) => (
                                        <div key={v.q} className="video-item" id={`video-${v.q}`}>
                                            <div className="video-title">Soru {v.q}</div>
                                            <div className="video-container">
                                                <video controls src={v.url} />
                                            </div>
                                            <div className="video-nav-buttons">
                                                {index > 0 && (
                                                    <button
                                                        onClick={() =>
                                                            document.getElementById(`video-${videos[index - 1].q}`)?.scrollIntoView({ behavior: 'smooth' })
                                                        }
                                                    >
                                                        ← Önceki Soru
                                                    </button>
                                                )}
                                                {index < videos.length - 1 && (
                                                    <button
                                                        onClick={() =>
                                                            document.getElementById(`video-${videos[index + 1].q}`)?.scrollIntoView({ behavior: 'smooth' })
                                                        }
                                                    >
                                                        Sonraki Soru →
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Toast */}
                <div className={`toast-notification ${toast.show ? 'show' : ''} ${toast.type}`}>
                    {toast.message}
                </div>
            </main>

            {/* Footer */}
            <footer style={{ textAlign: 'center', padding: '1rem', color: 'var(--color-muted-foreground)', fontSize: '0.875rem' }}>
                coded by <a href="https://instagram.com/127.0.0.28" target="_blank" rel="noopener noreferrer" style={{ color: 'red', textDecoration: 'none', fontWeight: 'bold' }}>mustafa</a>
            </footer>
        </div>
    );
}
