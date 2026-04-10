"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import QuestionSidebar from "@/components/playground/QuestionSidebar";
import ChatInterface from "@/components/playground/ChatInterface";
import HistoryPanel from "@/components/playground/HistoryPanel";
import { toast } from "sonner";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { authFetch } from "@/lib/tokenManager";
import { useStreamingChat } from "@/app/hooks/useStreamingChat";

interface SelectedQuestion {
  id: string;
  title: string;
  imageUrl?: string;
  bookId?: string;
}

interface Message {
  id: string;
  role: "user" | "model";
  content: string;
  hidden?: boolean;
  metadata?: {
    questionImageUrl?: string;
    questionImageUrls?: string[];
    questionIds?: string[];
    timestamp?: string;
  };
}

export default function PlaygroundPage() {
  const [mounted, setMounted] = useState(false);
  const [selectedQuestions, setSelectedQuestions] = useState<SelectedQuestion[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [historyUpdateTrigger, setHistoryUpdateTrigger] = useState(0);
  const [optimisticHistoryItem, setOptimisticHistoryItem] = useState<{
    id: string;
    session_title: string;
    title?: string;
    user_prompt: string;
    image_ids: string | null;
    created_at: string;
  } | null>(null);

  // Panel collapse state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [mobileDrawer, setMobileDrawer] = useState<'sidebar' | 'history' | null>(null);

  const { startStream, abort: abortStream } = useStreamingChat();
  const streamingContentRef = useRef('');

  // Handle hydration
  useEffect(() => {
    setMounted(true);
    // Set panel defaults based on viewport
    const isTablet = window.innerWidth < 1200;
    if (isTablet) {
      setSidebarOpen(false);
      setHistoryOpen(false);
    }
  }, []);

  // Initialize user ID after mount
  useEffect(() => {
    if (!mounted) return;

    try {
      const storedSelection = sessionStorage.getItem('playground_auto_select');
      if (storedSelection) {
        const parsed = JSON.parse(storedSelection);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSelectedQuestions(parsed);

          const resolveImages = async () => {
            const newQuestions = [...parsed];
            const resolvePromises: Promise<void>[] = [];

            for (let i = 0; i < newQuestions.length; i++) {
              const q = newQuestions[i];
              if (!q.imageUrl && q.bookId && q.id && q.id.includes('-q')) {
                resolvePromises.push(
                  (async () => {
                    try {
                      const parts = q.id.split('-q');
                      const res = await authFetch('/api/playground/resolve-image', {
                        method: 'POST',
                        body: JSON.stringify({
                          bookId: q.bookId,
                          testId: parts[0],
                          questionNumber: parts[1]
                        })
                      });
                      const data = await res.json();
                      if (data.success && data.imageUrl) {
                        newQuestions[i] = { ...newQuestions[i], imageUrl: data.imageUrl };
                      }
                    } catch (err) {
                      console.error('Error resolving image for question', q.id, err);
                    }
                  })()
                );
              }
            }

            if (resolvePromises.length > 0) {
              await Promise.all(resolvePromises);
              setSelectedQuestions([...newQuestions]);
              sessionStorage.setItem('playground_auto_select', JSON.stringify(newQuestions));
            }
          };

          resolveImages();
        }
      }
    } catch (e) {
      console.error("Failed to parse playground auto-select", e);
    }

    const authUuid = localStorage.getItem('user_uuid');
    const storedUsername = localStorage.getItem('playground_username') || localStorage.getItem('username');

    if (storedUsername) {
      setUserId(storedUsername);
      localStorage.setItem("playground_user_id", storedUsername);
    } else if (authUuid) {
      setUserId(authUuid);
      localStorage.setItem("playground_user_id", authUuid);
    } else {
      let storedUserId = localStorage.getItem("playground_user_id");
      if (!storedUserId) {
        storedUserId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem("playground_user_id", storedUserId);
      }
      setUserId(storedUserId);
    }
  }, [mounted]);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    const res = await authFetch(`/api/playground/history?sessionId=${encodeURIComponent(sessionId)}`);
    const payload = await res.json();
    const data = payload?.session;

    if (res.ok && data) {
      if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
        setMessages(data.messages);
      } else {
        const msgs: Message[] = [
          {
            id: `${data.id}-user`,
            role: "user",
            content: data.user_prompt,
            metadata: data.image_ids ? { questionImageUrls: data.image_ids.split(',') } : undefined
          },
        ];
        if (data.ai_response) {
          msgs.push({ id: `${data.id}-ai`, role: "model", content: data.ai_response });
        }
        setMessages(msgs);
      }
    }
  }, []);

  const saveToHistory = async (
    sessionId: string | null,
    messagesToSave: Message[],
    userPrompt: string,
    currentQuestions: SelectedQuestion[],
    aiResponse?: string
  ): Promise<string | null> => {
    const storedUser = localStorage.getItem('playground_username') || localStorage.getItem('username') || localStorage.getItem('user_uuid');
    const currentUserId = storedUser || userId;

    if (!currentUserId) {
      console.error("Supabase Save Aborted: No User Identity.");
      return sessionId;
    }

    const questionIds = currentQuestions.map(q => q.id).join(',');
    const imageUrls = currentQuestions.map(q => q.imageUrl).filter(Boolean).join(',');
    const firstTitle = currentQuestions.length > 0 ? currentQuestions[0].title : (userPrompt || "Yeni Görüşme");
    const sessionTitle = (firstTitle || "Görüşme").slice(0, 100);

    const messagesForDb = messagesToSave.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: m.metadata,
      sender: m.role === 'model' ? 'assistant' : 'user',
      timestamp: m.metadata?.timestamp || new Date().toISOString()
    }));

    const payload: any = {
      user_prompt: userPrompt,
      ai_response: aiResponse || null,
      messages: messagesForDb,
      question_ids: questionIds,
      image_ids: imageUrls,
      session_title: sessionTitle,
      title: sessionTitle,
      sender: aiResponse ? 'assistant' : 'user'
    };

    if (!sessionId || sessionId.startsWith('temp_')) {
      const tempId = sessionId || `temp_${Date.now()}`;
      setOptimisticHistoryItem({
        id: tempId,
        session_title: sessionTitle,
        title: sessionTitle,
        user_prompt: userPrompt,
        image_ids: imageUrls.split(',')[0] || null,
        created_at: new Date().toISOString()
      } as any);
      if (!sessionId) sessionId = tempId;
    }

    try {
      if (sessionId && !sessionId.startsWith('temp_')) {
        const res = await authFetch('/api/playground/history', {
          method: 'PATCH',
          body: JSON.stringify({ id: sessionId, ...payload })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          console.error("History Update Error:", data?.error || 'Unknown error');
        }
        return sessionId;
      } else {
        const res = await authFetch('/api/playground/history', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data?.session) {
          console.error("History Insert Error:", data?.error || 'Unknown error');
          return sessionId;
        }

        if (data.session) {
          setOptimisticHistoryItem(null);
          return data.session.id;
        }
      }
    } catch (err: any) {
      console.error("Supabase Unexpected Error:", err);
    }
    return sessionId;
  };

  useEffect(() => {
    if (currentSessionId) {
      loadSessionMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId, loadSessionMessages]);

  const updateSelectedQuestions = (newQuestions: SelectedQuestion[]) => {
    setSelectedQuestions(newQuestions);
    sessionStorage.setItem('playground_auto_select', JSON.stringify(newQuestions));
  };

  const handleToggleQuestion = (id: string, title: string, imageUrl?: string, bookId?: string) => {
    const prev = selectedQuestions;
    const exists = prev.find((q) => q.id === id);
    let newQuestions;
    if (exists) {
      newQuestions = prev.filter((q) => q.id !== id);
    } else {
      newQuestions = [...prev, { id, title, imageUrl, bookId }];
    }
    updateSelectedQuestions(newQuestions);
    setMobileDrawer(null);
  };

  const handleRemoveQuestion = (id: string) => {
    updateSelectedQuestions(selectedQuestions.filter(q => q.id !== id));
  };

  const handleClearAllQuestions = () => {
    updateSelectedQuestions([]);
  };

  const handleSendMessage = async (content: string) => {
    const activeUser = localStorage.getItem('playground_username') || localStorage.getItem('username') || localStorage.getItem('user_uuid') || userId;

    if (!activeUser) {
      toast.error("Oturum bulunamadı. Lütfen giriş yapın.");
      return;
    }

    setIsLoading(true);
    const finalContent = content.trim() || "Bu soruyu açıkla.";

    // 1. Resolve Images
    let currentQuestions = [...selectedQuestions];
    const questionsToResolve = currentQuestions.map((q, index) => ({ q, index }))
      .filter(({ q }) => !q.imageUrl && q.bookId && q.id.includes('-q'));

    if (questionsToResolve.length > 0) {
      await Promise.all(questionsToResolve.map(async ({ q, index }) => {
        try {
          const parts = q.id.split('-q');
          const res = await authFetch('/api/playground/resolve-image', {
            method: 'POST',
            body: JSON.stringify({ bookId: q.bookId, testId: parts[0], questionNumber: parts[1] })
          });
          const data = await res.json();
          if (data.success && data.imageUrl) {
            currentQuestions[index] = { ...currentQuestions[index], imageUrl: data.imageUrl };
          }
        } catch (err) { console.error("Image resolution error:", err); }
      }));
      setSelectedQuestions(currentQuestions);
    }

    const immediateImageUrls = currentQuestions.map(q => q.imageUrl).filter(Boolean) as string[];

    // 2. Create User Message
    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: finalContent,
      metadata: {
        questionImageUrls: immediateImageUrls,
        questionIds: currentQuestions.map(q => q.id),
        timestamp: new Date().toISOString()
      }
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    // 3. Initial Save
    const activeSessionId = await saveToHistory(
      currentSessionId,
      updatedMessages,
      finalContent,
      currentQuestions
    );

    if (activeSessionId && activeSessionId !== currentSessionId) {
      setCurrentSessionId(activeSessionId);
    }

    // 4. Create placeholder AI message and start streaming
    const aiMsgId = `ai_${Date.now()}`;
    const placeholderAiMsg: Message = {
      id: aiMsgId,
      role: "model",
      content: "",
      metadata: { timestamp: new Date().toISOString() }
    };

    const messagesWithPlaceholder = [...updatedMessages, placeholderAiMsg];
    setMessages(messagesWithPlaceholder);
    setIsStreaming(true);
    setStreamingMessageId(aiMsgId);
    setIsLoading(false);
    streamingContentRef.current = '';

    try {
      await startStream(
        '/api/playground/chat',
        {
          message: finalContent,
          history: updatedMessages,
          context: currentQuestions.map(q => ({ id: q.id, title: q.title, imageUrl: q.imageUrl, bookId: q.bookId })),
          imageUrl: immediateImageUrls[0],
          imageUrls: immediateImageUrls
        },
        {
          onMeta: (meta) => {
            // Could update resolved image URLs if needed
          },
          onToken: (token) => {
            streamingContentRef.current += token;
            const currentContent = streamingContentRef.current;
            setMessages(prev => prev.map(m =>
              m.id === aiMsgId ? { ...m, content: currentContent } : m
            ));
          },
          onDone: async (fullText) => {
            setIsStreaming(false);
            setStreamingMessageId(null);

            // Update message with final text
            setMessages(prev => {
              const final = prev.map(m =>
                m.id === aiMsgId ? { ...m, content: fullText } : m
              );

              // Save to history with full AI response
              const sessionIdToUse = activeSessionId || currentSessionId;
              saveToHistory(
                sessionIdToUse,
                final,
                finalContent,
                currentQuestions,
                fullText
              ).then(finalSessionId => {
                if (finalSessionId && finalSessionId !== currentSessionId) {
                  setCurrentSessionId(finalSessionId);
                }
                setHistoryUpdateTrigger(Date.now());
                setOptimisticHistoryItem(null);
              });

              return final;
            });
          },
          onError: (error) => {
            setIsStreaming(false);
            setStreamingMessageId(null);
            toast.error(`Hata: ${error}`);

            // Keep partial content if any
            if (!streamingContentRef.current) {
              setMessages(prev => prev.filter(m => m.id !== aiMsgId));
            }
          }
        },
        authFetch
      );
    } catch (error: any) {
      setIsStreaming(false);
      setStreamingMessageId(null);
      setIsLoading(false);
      toast.error(`Hata: ${error.message}`);
    }
  };

  const handleSelectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setSelectedQuestions([]);
  };

  const handleNewSession = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setSelectedQuestions([]);
    setOptimisticHistoryItem(null);
    setHistoryUpdateTrigger(Date.now());
    abortStream();
    setIsStreaming(false);
    setStreamingMessageId(null);
  };

  if (!mounted) {
    return (
      <div className="flex h-screen bg-[#0a0a0a] items-center justify-center">
        <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] overflow-hidden">
      {/* Top bar — 56px */}
      <header className="h-14 border-b border-[#2a2a2a] flex items-center justify-between px-4 bg-[#0a0a0a] shrink-0 z-50 sticky top-0">
        {/* Left: sidebar toggle + logo */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (window.innerWidth < 768) {
                setMobileDrawer(mobileDrawer === 'sidebar' ? null : 'sidebar');
              } else {
                setSidebarOpen(!sidebarOpen);
              }
            }}
            className="p-1.5 rounded-lg hover:bg-[#1e1e1e] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {sidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
          </button>
          <Link href="/" className="flex items-center gap-3">
            <span className="text-lg font-black tracking-tighter text-red-600 uppercase">DIJI-FETCH</span>
            <span className="text-[10px] font-bold tracking-[0.15em] text-zinc-400 uppercase hidden sm:inline bg-[#1e1e1e] px-2 py-0.5 rounded">
              AI Öğretmen
            </span>
          </Link>
        </div>

        {/* Center: breadcrumb */}
        <div className="hidden md:flex items-center text-xs text-zinc-500">
          {selectedQuestions.length > 0 && (
            <span className="truncate max-w-[300px]">
              {selectedQuestions[0].title.split(' - ').slice(0, 2).join(' / ')}
              {selectedQuestions.length > 1 && ` (+${selectedQuestions.length - 1})`}
            </span>
          )}
        </div>

        {/* Right: history toggle + back */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (window.innerWidth < 768) {
                setMobileDrawer(mobileDrawer === 'history' ? null : 'history');
              } else {
                setHistoryOpen(!historyOpen);
              }
            }}
            className="p-1.5 rounded-lg hover:bg-[#1e1e1e] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {historyOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
          </button>
          <Link
            href="/"
            className="px-3 py-1.5 border border-[#2a2a2a] text-zinc-400 text-xs font-medium rounded-lg hover:bg-[#1e1e1e] hover:text-zinc-200 transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Geri Dön
          </Link>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile backdrop */}
        <AnimatePresence>
          {mobileDrawer && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileDrawer(null)}
              className="fixed inset-0 bg-black/60 z-30 md:hidden"
            />
          )}
        </AnimatePresence>

        {/* Left Sidebar — Desktop: animated width, Mobile: overlay drawer */}
        <div className="hidden md:block">
          <motion.div
            animate={{ width: sidebarOpen ? 280 : 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="h-full overflow-hidden border-r border-[#2a2a2a] shrink-0"
          >
            <motion.div
              animate={{ opacity: sidebarOpen ? 1 : 0 }}
              transition={{ duration: 0.1 }}
              className="w-[280px] h-full"
            >
              <QuestionSidebar
                selectedQuestions={selectedQuestions}
                onToggleQuestion={handleToggleQuestion}
              />
            </motion.div>
          </motion.div>
        </div>

        {/* Mobile sidebar drawer */}
        <AnimatePresence>
          {mobileDrawer === 'sidebar' && (
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
              className="fixed left-0 top-14 bottom-0 w-[300px] z-40 md:hidden border-r border-[#2a2a2a]"
            >
              <QuestionSidebar
                selectedQuestions={selectedQuestions}
                onToggleQuestion={handleToggleQuestion}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Chat */}
        <div className="flex-1 min-w-0 w-full relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSessionId || "new-session"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0"
            >
              <ChatInterface
                selectedQuestions={selectedQuestions}
                messages={messages}
                onSendMessage={handleSendMessage}
                onClearSelection={handleClearAllQuestions}
                onRemoveQuestion={handleRemoveQuestion}
                isLoading={isLoading}
                isStreaming={isStreaming}
                streamingMessageId={streamingMessageId}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Right History Panel — Desktop: animated width */}
        <div className="hidden md:block">
          <motion.div
            animate={{ width: historyOpen ? 300 : 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="h-full overflow-hidden shrink-0"
          >
            <motion.div
              animate={{ opacity: historyOpen ? 1 : 0 }}
              transition={{ duration: 0.1 }}
              className="w-[300px] h-full"
            >
              <HistoryPanel
                userId={userId}
                currentSessionId={currentSessionId}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                lastUpdate={historyUpdateTrigger}
                optimisticSession={optimisticHistoryItem}
              />
            </motion.div>
          </motion.div>
        </div>

        {/* Mobile history drawer */}
        <AnimatePresence>
          {mobileDrawer === 'history' && (
            <motion.div
              initial={{ x: 300 }}
              animate={{ x: 0 }}
              exit={{ x: 300 }}
              transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
              className="fixed right-0 top-14 bottom-0 w-[300px] z-40 md:hidden"
            >
              <HistoryPanel
                userId={userId}
                currentSessionId={currentSessionId}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                lastUpdate={historyUpdateTrigger}
                optimisticSession={optimisticHistoryItem}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
