"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import QuestionSidebar from "@/components/playground/QuestionSidebar";
import ChatInterface from "@/components/playground/ChatInterface";
import HistoryPanel from "@/components/playground/HistoryPanel";
import { supabase } from "@/lib/db/supabase";
import { toast } from "sonner";
import { Menu, X, ArrowLeft, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
  const [userId, setUserId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyUpdateTrigger, setHistoryUpdateTrigger] = useState(0);
  const [optimisticHistoryItem, setOptimisticHistoryItem] = useState<{
    id: string;
    session_title: string;
    title?: string;
    user_prompt: string;
    image_ids: string | null;
    created_at: string;
  } | null>(null);

  // Handle hydration - only render after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialize user ID after mount (client-side only)
  useEffect(() => {
    if (!mounted) return;
    
    // Check and load auto-selected questions from session storage
    try {
        const storedSelection = sessionStorage.getItem('playground_auto_select');
        if (storedSelection) {
            const parsed = JSON.parse(storedSelection);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // Initial load
                setSelectedQuestions(parsed);

                // Check for missing images and resolve them in parallel
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
                                        const testId = parts[0];
                                        const questionNumber = parts[1];

                                        const res = await fetch('/api/playground/resolve-image', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                bookId: q.bookId,
                                                testId: testId,
                                                questionNumber: questionNumber
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

    // Check key from main auth first
    const authUuid = localStorage.getItem('user_uuid');
    const storedUsername = localStorage.getItem('playground_username') || localStorage.getItem('username'); // Check both keys
    
    if (storedUsername) {
        setUserId(storedUsername);
        localStorage.setItem("playground_user_id", storedUsername); // Sync local preference
        console.log("Playground: Using Username as ID:", storedUsername);
    } else if (authUuid) {
        setUserId(authUuid);
        localStorage.setItem("playground_user_id", authUuid);
        console.log("Playground: Using UUID as ID:", authUuid);
    } else {
        let storedUserId = localStorage.getItem("playground_user_id");
        if (!storedUserId) {
          storedUserId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          localStorage.setItem("playground_user_id", storedUserId);
        }
        setUserId(storedUserId);
        console.log("Playground: Using Generated/Stored ID:", storedUserId);
    }
  }, [mounted]);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    const { data } = await supabase
      .from("ai_log")
      .select("*")
      .eq("id", sessionId)
      .single();
    
    if (data) {
      if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
        setMessages(data.messages);
      } else {
        // Fallback for old single-turn rows
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

  // Debugging Supabase Client
  useEffect(() => {
    console.log("Playground Page Mounted. Supabase Client:", !!supabase, "User ID:", userId);
  }, [userId]);

  const saveToHistory = async (
    sessionId: string | null,
    messagesToSave: Message[],
    userPrompt: string,
    currentQuestions: SelectedQuestion[],
    aiResponse?: string
  ): Promise<string | null> => {
      // 1. Validate User
      const storedUser = localStorage.getItem('playground_username') || localStorage.getItem('username') || localStorage.getItem('user_uuid');
      const currentUserId = storedUser || userId;
      
      if (!currentUserId) {
          console.error("Supabase Save Aborted: No User Identity.");
          return sessionId;
      }

      // 2. Prepare Payload
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
            username: currentUserId,
            user_prompt: userPrompt,
            ai_response: aiResponse || null,
            messages: messagesForDb,
            question_ids: questionIds,
            image_ids: imageUrls,
            session_title: sessionTitle,
            title: sessionTitle,
            sender: aiResponse ? 'assistant' : 'user'
      };

      // Optimistic UI for new sessions
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
              // UPDATE path
              const { error } = await supabase
                  .from("ai_log")
                  .update(payload)
                  .eq("id", sessionId);
              
              if (error) {
                  console.error("Supabase Update Error:", error);
              }
              return sessionId;
          } else {
              // INSERT path
              const { data, error } = await supabase
                  .from("ai_log")
                  .insert([payload])
                  .select()
                  .single();
              
              if (error) {
                  console.error("Supabase Insert Error:", error);
                  return sessionId;
              }

              if (data) {
                  setOptimisticHistoryItem(null); // Clear once real data is in
                  return data.id;
              }
          }
      } catch (err: any) {
          console.error("Supabase Unexpected Error:", err);
      }
      return sessionId;
  };

  // Load messages when session changes
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
    setSidebarOpen(false); // Close mobile drawer
  };

  const handleRemoveQuestion = (id: string) => {
    const newQuestions = selectedQuestions.filter(q => q.id !== id);
    updateSelectedQuestions(newQuestions);
  };

  const handleClearAllQuestions = () => {
    updateSelectedQuestions([]);
  };

  const handleSendMessage = async (content: string) => {
    // Re-verify ID before sending
    const activeUser = localStorage.getItem('playground_username') || localStorage.getItem('username') || localStorage.getItem('user_uuid') || userId;
    
    if (!activeUser) {
      toast.error("Oturum bulunamadı. Lütfen giriş yapın.");
      return;
    }

    setIsLoading(true);
    const finalContent = content.trim() || "Bu soruyu açıkla.";

    // 1. Resolve Images (Restored)
    let currentQuestions = [...selectedQuestions];
    const questionsToResolve = currentQuestions.map((q, index) => ({ q, index }))
        .filter(({ q }) => !q.imageUrl && q.bookId && q.id.includes('-q'));

    if (questionsToResolve.length > 0) {
        await Promise.all(questionsToResolve.map(async ({ q, index }) => {
            try {
                const parts = q.id.split('-q');
                const res = await fetch('/api/playground/resolve-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
          questionImageUrls: immediateImageUrls, // Restored
          questionIds: currentQuestions.map(q => q.id),
          timestamp: new Date().toISOString()
      }
    };
    
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    // 3. Initial Save (Ensures record exists in DB)
    const activeSessionId = await saveToHistory(
        currentSessionId, 
        updatedMessages, 
        finalContent, 
        currentQuestions
    );
    
    if (activeSessionId && activeSessionId !== currentSessionId) {
        setCurrentSessionId(activeSessionId);
    }
    // Note: Don't trigger history refresh here — wait until AI response is saved (below)

    // 4. AI Request
    try {
      const response = await fetch("/api/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: finalContent,
          history: updatedMessages, 
          context: currentQuestions.map(q => ({ id: q.id, title: q.title, imageUrl: q.imageUrl, bookId: q.bookId })),
          imageUrl: immediateImageUrls[0],
          imageUrls: immediateImageUrls
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || "AI Response failed");

      // 5. Create AI Message
      const aiMsg: Message = { 
          id: `ai_${Date.now()}`, 
          role: "model", 
          content: data.reply,
          metadata: { timestamp: new Date().toISOString() }
      };
      
      const sessionWithAi = [...updatedMessages, aiMsg];
      setMessages(sessionWithAi);

      // 6. FINAL PERSISTENT SAVE (User + AI + Context)
      const finalSessionId = await saveToHistory(
          activeSessionId, 
          sessionWithAi, 
          finalContent, 
          currentQuestions, 
          data.reply
      );

      // Ensure we keep the correct ID and refresh the history list
      if (finalSessionId && finalSessionId !== currentSessionId) {
          setCurrentSessionId(finalSessionId);
      }
      setHistoryUpdateTrigger(Date.now()); // Force history list to refresh with AI response
      setOptimisticHistoryItem(null); // Clear optimistic item

    } catch (error: any) {
      toast.error(`Hata: ${error.message}`);
      console.error(error);
    } finally {
      setIsLoading(false);
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
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="flex h-screen bg-black items-center justify-center">
        <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-black overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-4 md:px-8 bg-black/60 backdrop-blur-2xl shrink-0 z-50 sticky top-0">
            <div className="flex items-center gap-6">
                <button 
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="md:hidden text-zinc-400 hover:text-white p-2 hover:bg-white/5 rounded-full transition-all"
                >
                  {sidebarOpen ? <X className="w-5 h-5"/> : <Menu className="w-5 h-5"/>}
                </button>
                <Link href="/" className="group flex items-center">
                  <span className="text-2xl font-black tracking-tighter text-red-600 uppercase">DIJI-FETCH</span>
                  <div className="flex items-center gap-2 bg-white/5 px-3 py-1 rounded-full border border-white/10 ml-4 hidden sm:flex">
                    <Sparkles className="w-3 h-3 text-red-500 animate-pulse" />
                    <span className="text-[10px] font-black tracking-[0.2em] text-white uppercase">AI Öğretmen</span>
                  </div>
                </Link>
            </div>

            <nav className="flex items-center gap-2 md:gap-4">
                <Link href="/" className="px-5 py-2 bg-white text-black text-xs sm:text-sm font-black rounded-full hover:bg-zinc-200 transition-all shadow-xl shadow-white/5 flex items-center gap-2">
                  <ArrowLeft className="w-4 h-4" />
                  Geri Dön
                </Link>
            </nav>
        </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar */}
        <div className={`
            absolute md:relative z-40 h-full bg-black md:bg-transparent transition-transform duration-300 ease-in-out border-r border-zinc-900 md:border-r-0
            ${sidebarOpen ? 'translate-x-0 w-full' : '-translate-x-full md:translate-x-0'}
            md:w-1/4 md:min-w-[250px] md:max-w-[400px]
        `}>
            <QuestionSidebar 
            selectedQuestions={selectedQuestions}
            onToggleQuestion={handleToggleQuestion} 
            />
        </div>

        {/* Main Chat (Flex 1) */}
        <div className="flex-1 min-w-0 w-full relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSessionId || "new-session"}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="absolute inset-0"
            >
              <ChatInterface 
                selectedQuestions={selectedQuestions}
                messages={messages} 
                onSendMessage={handleSendMessage}
                onClearSelection={handleClearAllQuestions}
                onRemoveQuestion={handleRemoveQuestion}
                isLoading={isLoading}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Right History Panel */}
        <div className="w-[300px] shrink-0 hidden md:block">
            <HistoryPanel 
            userId={userId}
            currentSessionId={currentSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
            lastUpdate={historyUpdateTrigger}
            optimisticSession={optimisticHistoryItem}
            />
        </div>
      </div>
    </div>
  );
}
