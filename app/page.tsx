"use client";

import { useState, useEffect, useRef, useCallback, ChangeEvent } from "react";
import { useTheme } from "next-themes";
import "katex/dist/katex.min.css";
import LoginModal from "@/components/LoginModal";
import { Button } from "@/components/ui/button";
import ProgramView from "@/components/ProgramView";
import MemoPad from "@/components/MemoPad";
import VideoPlayer from "@/components/VideoPlayer";
import AiChat from "@/components/AiChat";
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ToastState } from "@/types";
import {
  Moon,
  Sun,
  ArrowLeft,
  Settings,
  LogIn,
  BookOpen,
  ClipboardList,
  ChevronRight,
  ChevronLeft,
  Calendar,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  Bot,
  Sparkles,
  Shield,
  Menu,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Custom Hooks
import { useAuth } from "@/app/hooks/useAuth";
import { useProgram } from "@/app/hooks/useProgram";
import { useAssignments } from "@/app/hooks/useAssignments";
import { useBooks } from "@/app/hooks/useBooks";
import { useTestRunner } from "@/app/hooks/useTestRunner";
import { useAiTutor } from "@/app/hooks/useAiTutor";

type ActiveTab = "books" | "assignments" | "test-view" | "program" | "memo";

export default function Home() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // UI State
  const [activeTab, setActiveTab] = useState<ActiveTab>("books");
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [scrolled, setScrolled] = useState(false);
  const [toast, setToast] = useState<ToastState>({
    show: false,
    message: "",
    type: "success",
  });
  const [lastVisitedTestIndex, setLastVisitedTestIndex] = useState<
    number | null
  >(null);
  const testListRef = useRef<HTMLDivElement>(null);

  // Helper: Toast
  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success"): void => {
      setToast({ show: true, message, type });
      setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 2000);
    },
    [],
  );

  // Hooks
  const auth = useAuth(showToast);
  const program = useProgram(showToast);
  const assignments = useAssignments(
    showToast,
    auth.refreshCookies,
    auth.setIsLoggedIn,
  );
  const books = useBooks();
  const testRunner = useTestRunner(
    showToast,
    program.schedule,
    program.setSchedule,
  );
  const aiTutor = useAiTutor();

  // Side Effects
  useEffect(() => {
    setMounted(true);
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);

    const handleResize = () => {
      if (window.innerWidth >= 1024 && mobileMenuOpen) setMobileMenuOpen(false);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (auth.isLoggedIn) {
      setActiveTab("assignments");
      assignments.fetchAssignments();
    }
  }, [auth.isLoggedIn]); // fetch on login ?? This might loop if not careful.
  // Original code: on mount if logged in -> fetch. handleLoginSuccess -> fetch.
  // useAuth reads localStorage on mount and sets isLoggedIn true.
  // So this effect will run once on mount if logged in. Correct.

  useEffect(() => {
    if (activeTab === "program") {
      program.fetchProgram(false);
    }
  }, [activeTab]);

  // Handlers
  const handleLogoutWrapped = () => {
    auth.handleLogout();
    setActiveTab("books");
    setShowSettings(false);
  };

  const handleAssignmentClickWrapped = async (a: any) => {
    const success = await testRunner.openAssignment(a);
    if (success) {
      setActiveTab("test-view");
    }
  };

  const handleBookTestClick = (test: any, index: number) => {
    setLastVisitedTestIndex(index);
    testRunner.setSelectedTest(test);
    testRunner.loadTest(test.id);
    // Note: original code didn't change tab here because book view IS the tab,
    // but it showed conditional rendering based on selectedTest.
    // My unified logic: activeTab is still 'books', but if selectedTest is not null, it shows test view.
    // Wait, original code logic:
    // {activeTab === 'books' && !selectedTest && ...}
    // {(selectedTest || activeTab === 'test-view') && selectedTest && ...}
    // So setting selectedTest to non-null switches the view effectively.
  };

  const handleAskAIWrapped = (q: string) => {
    aiTutor.handleAskAI(
      q,
      testRunner.selectedTest,
      String(books.selectedBook?.id || ""),
    );
  };

  const handleSendToPlayground = (video: any) => {
    if (!books.selectedBook || !testRunner.selectedTest) return;

    const newQuestion = {
      id: `${testRunner.selectedTest.id}-q${video.q}`,
      title: `${testRunner.selectedTest.name} - Soru ${video.q}`,
      bookId: String(books.selectedBook.id),
      // Image URL will be resolved by Playground or user can verify context
    };

    // Get existing selection to append
    let currentSelection: any[] = [];
    try {
      const stored = sessionStorage.getItem("playground_auto_select");
      if (stored) {
        currentSelection = JSON.parse(stored);
        if (!Array.isArray(currentSelection)) currentSelection = [];
      }
    } catch (e) {
      currentSelection = [];
    }

    // Avoid adding duplicates
    if (!currentSelection.find((q) => q.id === newQuestion.id)) {
      currentSelection.push(newQuestion);
      sessionStorage.setItem(
        "playground_auto_select",
        JSON.stringify(currentSelection),
      );
      showToast("Soru AI Öğretmen'e eklendi.", "success");
    } else {
      showToast("Bu soru zaten seçili.", "success");
    }
  };

  if (!mounted) return null;

  // Derived Error
  const currentError =
    activeTab === "assignments"
      ? assignments.error
      : activeTab === "books" && !testRunner.selectedTest
        ? books.bookError
        : testRunner.error;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Login Modal */}
      {auth.showLoginModal && (
        <LoginModal
          onClose={() => auth.setShowLoginModal(false)}
          onLoginSuccess={auth.handleLoginSuccess}
        />
      )}

      {/* Header */}
      <header
        className={`header ${scrolled ? "header-scrolled" : ""} ${mobileMenuOpen ? "header-expanded" : ""}`}
      >
        <div className="header-main-bar flex items-center justify-between w-full">
          <div
            className="logo"
            onClick={() => {
              setActiveTab("books");
              testRunner.setSelectedTest(null);
              books.setSelectedSubject(null);
              books.setSelectedBook(null);
            }}
          >
            DIJI-FETCH
          </div>

          {/* Desktop Nav */}
          <nav className="nav hidden lg:flex">
            {auth.isLoggedIn ? (
              <>
                <button
                  className={`nav-btn ${activeTab === "assignments" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("assignments");
                    testRunner.setSelectedTest(null);
                    books.setSelectedSubject(null);
                    books.setSelectedBook(null);
                  }}
                >
                  <ClipboardList className="w-4 h-4 mr-2 inline" />
                  Ödevlerim
                </button>
                <button
                  className={`nav-btn ${activeTab === "program" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("program");
                    testRunner.setSelectedTest(null);
                    books.setSelectedSubject(null);
                    books.setSelectedBook(null);
                  }}
                >
                  <Calendar className="w-4 h-4 mr-2 inline" />
                  Program
                </button>
                <button
                  className={`nav-btn ${activeTab === "books" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("books");
                    testRunner.setSelectedTest(null);
                    books.setSelectedSubject(null);
                    books.setSelectedBook(null);
                  }}
                >
                  <BookOpen className="w-4 h-4 mr-2 inline" />
                  Kitaplar
                </button>
                <Link href="/playground" className="nav-btn group">
                  <Sparkles className="w-4 h-4 text-red-500 group-hover:animate-pulse" />
                  <span className="ml-1">AI Öğretmen</span>
                </Link>
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
                onClick={() => auth.setShowLoginModal(true)}
                className="login-btn"
              >
                <LogIn className="w-4 h-4 mr-2" />
                Giriş Yap
              </Button>
            )}

            <button
              className="theme-toggle"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Tema değiştir"
            >
              {theme === "dark" ? (
                <Moon className="w-5 h-5" />
              ) : (
                <Sun className="w-5 h-5" />
              )}
            </button>
          </nav>

          {/* Mobile Menu Button */}
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Menü"
          >
            {mobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>

        {/* Mobile Nav Content (Inside expanded header) */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="mobile-nav-inline lg:hidden overflow-hidden w-full"
            >
              <div className="pt-4 pb-2 flex flex-col gap-2">
                {auth.isLoggedIn ? (
                  <>
                    <button
                      className={`mobile-nav-item ${activeTab === "assignments" ? "active" : ""}`}
                      onClick={() => {
                        setActiveTab("assignments");
                        setMobileMenuOpen(false);
                      }}
                    >
                      <ClipboardList className="w-5 h-5 mr-3" />
                      Ödevlerim
                    </button>
                    <button
                      className={`mobile-nav-item ${activeTab === "program" ? "active" : ""}`}
                      onClick={() => {
                        setActiveTab("program");
                        setMobileMenuOpen(false);
                      }}
                    >
                      <Calendar className="w-5 h-5 mr-3" />
                      Program
                    </button>
                    <button
                      className={`mobile-nav-item ${activeTab === "books" ? "active" : ""}`}
                      onClick={() => {
                        setActiveTab("books");
                        setMobileMenuOpen(false);
                      }}
                    >
                      <BookOpen className="w-5 h-5 mr-3" />
                      Kitaplar
                    </button>
                    <Link
                      href="/playground"
                      className="mobile-nav-item"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <Sparkles className="w-5 h-5 mr-3 text-red-500" />
                      AI Öğretmen
                    </Link>
                    <button
                      className="mobile-nav-item"
                      onClick={() => {
                        setShowSettings(true);
                        setMobileMenuOpen(false);
                      }}
                    >
                      <Settings className="w-5 h-5 mr-3" />
                      Ayarlar
                    </button>
                  </>
                ) : (
                  <button
                    className="mobile-nav-item"
                    onClick={() => {
                      auth.setShowLoginModal(true);
                      setMobileMenuOpen(false);
                    }}
                  >
                    <LogIn className="w-5 h-5 mr-3" />
                    Giriş Yap
                  </button>
                )}
                <div className="h-[1px] bg-border my-1" />
                <button
                  className="mobile-nav-item"
                  onClick={() => {
                    setTheme(theme === "dark" ? "light" : "dark");
                    setMobileMenuOpen(false);
                  }}
                >
                  {theme === "dark" ? (
                    <Moon className="w-5 h-5 mr-3" />
                  ) : (
                    <Sun className="w-5 h-5 mr-3" />
                  )}
                  {theme === "dark" ? "Açık Mod" : "Koyu Mod"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

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
                <p
                  className="text-sm"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {theme === "dark" ? "Koyu mod aktif" : "Açık mod aktif"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Sun
                  className="w-4 h-4"
                  style={{ color: "var(--color-muted-foreground)" }}
                />
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={(checked) =>
                    setTheme(checked ? "dark" : "light")
                  }
                />
                <Moon
                  className="w-4 h-4"
                  style={{ color: "var(--color-muted-foreground)" }}
                />
              </div>
            </div>

            <Separator />

            {/* Logout */}
            {auth.isLoggedIn && (
              <Button
                variant="destructive"
                className="w-full"
                onClick={handleLogoutWrapped}
              >
                Çıkış Yap
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Main Content */}
      <main className="main">
        {currentError && <div className="error-banner">{currentError}</div>}

        {/* Books View */}
        {activeTab === "books" &&
          !testRunner.selectedTest &&
          (!books.selectedSubject ? (
            <div>
              <h1 className="section-title">Dersler</h1>
              <div className="grid-cards">
                {books.subjects.map((s) => (
                  <Card
                    key={s}
                    className="subject-card group"
                    onClick={() => books.setSelectedSubject(s)}
                  >
                    <h3 className="group-hover:text-accent transition-colors">
                      {s}
                    </h3>
                  </Card>
                ))}
              </div>
            </div>
          ) : !books.selectedBook ? (
            <div>
              <button
                className="back-btn"
                onClick={() => books.setSelectedSubject(null)}
              >
                <ArrowLeft className="w-4 h-4" />
                Derslere Dön
              </button>
              <h1 className="section-title">{books.selectedSubject}</h1>
              <div className="grid-cards">
                {books.currentBooks.map((b) => (
                  <Card
                    key={b.id}
                    className="subject-card group"
                    onClick={() => books.handleBookClick(b)}
                  >
                    <h3 className="text-sm group-hover:text-accent transition-colors">
                      {b.name}
                    </h3>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <button
                className="back-btn"
                onClick={() => books.setSelectedBook(null)}
              >
                <ArrowLeft className="w-4 h-4" />
                Kitaplara Dön
              </button>
              <h1 className="section-title">{books.selectedBook.name}</h1>
              {books.loadingTests ? (
                <div className="loader">Yükleniyor...</div>
              ) : (
                <div className="test-list-wrapper">
                  <div className="test-list-scroll" ref={testListRef}>
                    {books.bookTests.map((test, index) => (
                      <div
                        key={test.id}
                        id={`test-item-${index}`}
                        className={`test-list-item group ${lastVisitedTestIndex === index ? "visited" : ""}`}
                        onClick={() => handleBookTestClick(test, index)}
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
          ))}

        {/* Assignments View */}
        {activeTab === "assignments" && !testRunner.selectedTest && (
          <div>
            <h1 className="section-title">Ödevlerim</h1>
            {assignments.loading && (
              <div className="flex items-center gap-3 py-8 text-zinc-500 font-mono text-sm">
                <Loader2 className="w-4 h-4 text-red-600 animate-spin" />
                {assignments.loadingText}
              </div>
            )}
            {assignments.assignments.length > 0 ? (
              <div className="grid-cards">
                {assignments.assignments.map((a) => (
                  <Card
                    key={a.id}
                    className={`assignment-card group ${a.status === "deactive" ? "opacity-40 grayscale pointer-events-none cursor-not-allowed border-dashed" : "cursor-pointer"}`}
                    onClick={() =>
                      a.status !== "deactive" && handleAssignmentClickWrapped(a)
                    }
                  >
                    <CardHeader className="p-0 pb-2">
                      <div className="flex justify-between items-center">
                        <span
                          className={`badge ${a.status === "deactive" ? "bg-zinc-800 text-zinc-500" : ""}`}
                        >
                          {a.status === "deactive" ? "PASİF" : "ÖDEV"}
                        </span>
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
            ) : (
              !assignments.loading && (
                <p className="empty-msg">Aktif ödev bulunamadı.</p>
              )
            )}
          </div>
        )}

        {/* Program View */}
        {activeTab === "program" && !testRunner.selectedTest && (
          <div className="space-y-6">
            <div className="w-full flex justify-end px-6 max-w-[1600px] mx-auto">
              <button
                onClick={() => program.fetchProgram(true)}
                disabled={program.isAnalyzing}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors text-sm ${program.isAnalyzing ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {program.isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Program Yenileniyor...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    PDF ile Yenile
                  </>
                )}
              </button>
            </div>

            {program.schedule &&
            program.schedule.tasks &&
            program.schedule.tasks.length > 0 ? (
              <ProgramView
                schedule={program.schedule}
                onToggleTask={program.toggleTask}
                onToggleDay={program.toggleDayTasks}
                onToggleSubject={program.toggleSubjectTasks}
              />
            ) : (
              <div className="w-full max-w-[1600px] mx-auto px-6">
                <div className="text-center py-12 border-2 border-dashed border-zinc-800 rounded-xl bg-surface-dark">
                  <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium text-white">
                    Henüz bir program yok
                  </h3>
                  <p className="text-zinc-500 mt-2 max-w-sm mx-auto">
                    <strong>public/program.pdf</strong> dosyasını ekleyin ve
                    "PDF ile Yenile" butonuna tıklayın.
                  </p>
                </div>
              </div>
            )}

            {program.schedule &&
              program.schedule.tasks &&
              program.schedule.tasks.length > 0 && (
                <div className="flex justify-center pt-4 pb-8">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (
                        confirm(
                          "Tüm program ilerlemenizi sıfırlamak istediğinize emin misiniz?",
                        )
                      ) {
                        const resetTasks = program.schedule!.tasks.map((t) => ({
                          ...t,
                          completed: false,
                        }));
                        const resetSchedule = {
                          ...program.schedule!,
                          tasks: resetTasks,
                        };
                        program.setSchedule(resetSchedule);
                        localStorage.setItem(
                          "weeklySchedule",
                          JSON.stringify(resetSchedule),
                        );
                        showToast("Program sıfırlandı.", "success");
                      }
                    }}
                    className="text-zinc-600 hover:text-red-500"
                  >
                    İlerlemeyi Sıfırla
                  </Button>
                </div>
              )}
          </div>
        )}

        {/* Test View (Shared) */}
        {(testRunner.selectedTest || activeTab === "test-view") &&
          testRunner.selectedTest && (
            <div>
              {/* Toolbar */}
              <div className="flex flex-col gap-4 mb-8 pb-6">
                <button
                  className="back-btn"
                  onClick={() => {
                    testRunner.setSelectedTest(null);
                    setActiveTab(
                      auth.isLoggedIn && testRunner.assignmentContext
                        ? "assignments"
                        : "books",
                    );
                    // Scroll to last visited test
                    if (lastVisitedTestIndex !== null) {
                      setTimeout(() => {
                        const element = document.getElementById(
                          `test-item-${lastVisitedTestIndex}`,
                        );
                        if (element && testListRef.current) {
                          element.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        }
                      }, 100);
                    }
                  }}
                >
                  <ArrowLeft className="w-4 h-4" />
                  Geri Dön
                </button>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <h1 className="text-2xl font-bold">
                    {testRunner.selectedTest.name}
                  </h1>
                  {auth.isLoggedIn && (
                    <Button
                      className="save-btn"
                      onClick={testRunner.saveAnswers}
                      disabled={testRunner.isSaving}
                    >
                      {testRunner.isSaving
                        ? "Kaydediliyor..."
                        : "Cevapları Kaydet"}
                    </Button>
                  )}
                </div>
              </div>

              {/* Split Layout */}
              <div className="split-layout">
                {/* Answer Panel */}
                {testRunner.data && (
                  <div className="panel">
                    <div className="panel-header">Cevap Anahtarı</div>
                    <div className="answers-grid">
                      {testRunner.data.CevapAnahtari.split("").map((ans, i) => (
                        <div key={i} className="answer-item">
                          <div className="q-num">{i + 1}</div>
                          <div className="q-val">{ans}</div>
                          {auth.isLoggedIn && (
                            <select
                              value={testRunner.userAnswers[i + 1] || ""}
                              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                testRunner.setUserAnswers({
                                  ...testRunner.userAnswers,
                                  [i + 1]: e.target.value,
                                })
                              }
                            >
                              <option value="">-</option>
                              {["A", "B", "C", "D", "E"].map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Test Score Boxes */}
                    {testRunner.testScore &&
                      testRunner.testScore.hasAnswers && (
                        <div className="score-boxes">
                          <div className="score-box dogru">
                            <span className="score-label">Doğru</span>
                            <span className="score-value">
                              {testRunner.testScore.dogru}
                            </span>
                          </div>
                          <div className="score-box yanlis">
                            <span className="score-label">Yanlış</span>
                            <span className="score-value">
                              {testRunner.testScore.yanlis}
                            </span>
                          </div>
                          <div className="score-box bos">
                            <span className="score-label">Boş</span>
                            <span className="score-value">
                              {testRunner.testScore.bos}
                            </span>
                          </div>
                          <div className="score-box net">
                            <span className="score-label">Net</span>
                            <span className="score-value">
                              {testRunner.testScore.net}
                            </span>
                          </div>
                        </div>
                      )}
                    {testRunner.loadingScore && (
                      <div className="score-loading">Skor hesaplanıyor...</div>
                    )}

                    {/* Test Navigation Buttons */}
                    <div className="test-nav-buttons">
                      <button
                        className="test-nav-btn"
                        disabled={
                          !books.bookTests.length ||
                          lastVisitedTestIndex === null ||
                          lastVisitedTestIndex <= 0
                        }
                        onClick={() => {
                          if (
                            lastVisitedTestIndex !== null &&
                            lastVisitedTestIndex > 0
                          ) {
                            const prevIndex = lastVisitedTestIndex - 1;
                            const prevTest = books.bookTests[prevIndex];
                            if (prevTest) {
                              setLastVisitedTestIndex(prevIndex);
                              testRunner.setSelectedTest(prevTest);
                              testRunner.loadTest(prevTest.id);
                            }
                          }
                        }}
                      >
                        <ChevronLeft className="w-4 h-4" />
                        Önceki
                      </button>
                      <button
                        className="test-nav-btn"
                        disabled={
                          !books.bookTests.length ||
                          lastVisitedTestIndex === null ||
                          lastVisitedTestIndex >= books.bookTests.length - 1
                        }
                        onClick={() => {
                          if (
                            lastVisitedTestIndex !== null &&
                            lastVisitedTestIndex < books.bookTests.length - 1
                          ) {
                            const nextIndex = lastVisitedTestIndex + 1;
                            const nextTest = books.bookTests[nextIndex];
                            if (nextTest) {
                              setLastVisitedTestIndex(nextIndex);
                              testRunner.setSelectedTest(nextTest);
                              testRunner.loadTest(nextTest.id);
                            }
                          }
                        }}
                      >
                        Sonraki
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Video Panel */}
                <div className="panel">
                  <div className="panel-header">
                    Video Çözümler
                    <span
                      className={`status-indicator ${
                        testRunner.videoStatus === "Tamamlandı"
                          ? "success"
                          : testRunner.videoStatus === "Hata"
                            ? "error"
                            : "loading"
                      }`}
                    >
                      <span className="status-dot" />
                      {testRunner.videoStatus}
                    </span>
                  </div>
                  <div className="video-list">
                    {testRunner.videos.map((v, index) => (
                      <div key={v.q} className="video-item" id={`video-${v.q}`}>
                        <div className="video-title flex justify-between items-center">
                          <span>Soru {v.q}</span>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs gap-1.5 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors"
                            onClick={() => handleSendToPlayground(v)}
                          >
                            <Sparkles className="w-3 h-3" />
                            AI'a Gönder
                          </Button>
                        </div>
                        <div className="video-container">
                          <VideoPlayer
                            src={v.url}
                            videoId={`${testRunner.selectedTest?.id}-q${v.q}`}
                            autoPlay={false}
                          />
                        </div>

                        {/* AI CHAT INTERFACE */}
                        {aiTutor.activeAiQuestion === v.q.toString() &&
                          aiTutor.aiContext && (
                            <div className="mt-4 px-2">
                              <AiChat
                                initialMessage={aiTutor.aiInitialMessage}
                                questionContext={aiTutor.aiContext}
                                onClose={() =>
                                  aiTutor.setActiveAiQuestion(null)
                                }
                              />
                            </div>
                          )}

                        <div className="video-nav-buttons">
                          {index > 0 && (
                            <button
                              onClick={() =>
                                document
                                  .getElementById(
                                    `video-${testRunner.videos[index - 1].q}`,
                                  )
                                  ?.scrollIntoView({ behavior: "smooth" })
                              }
                            >
                              ← Önceki Soru
                            </button>
                          )}
                          {index < testRunner.videos.length - 1 && (
                            <button
                              onClick={() =>
                                document
                                  .getElementById(
                                    `video-${testRunner.videos[index + 1].q}`,
                                  )
                                  ?.scrollIntoView({ behavior: "smooth" })
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

        {/* Memo View (Optional) */}
        {activeTab === "memo" && (
          <div className="container max-w-4xl mx-auto p-4 h-[calc(100vh-100px)]">
            <MemoPad />
          </div>
        )}

        {/* Toast */}
        <div
          className={`toast-notification ${toast.show ? "show" : ""} ${toast.type}`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <XCircle className="w-5 h-5" />
          )}
          <span>{toast.message}</span>
        </div>
      </main>

      <footer
        style={{
          textAlign: "center",
          padding: "1rem",
          color: "var(--color-muted-foreground)",
          fontSize: "0.875rem",
        }}
      >
        dev by:{" "}
        <a
          href="https://instagram.com/127.0.0.28"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "red", textDecoration: "none", fontWeight: "bold" }}
        >
          mustafa
        </a>
      </footer>
    </div>
  );
}
