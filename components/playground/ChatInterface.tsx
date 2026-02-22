"use client";

import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, X, Bot, User, Image as ImageIcon, Loader2 } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface Message {
  id: string;
  role: "user" | "model";
  content: string;
  hidden?: boolean;
  metadata?: {
    questionImageUrl?: string;
    questionImageUrls?: string[];
  };
}

interface SelectedQuestion {
  id: string;
  title: string;
  imageUrl?: string;
}

interface ChatInterfaceProps {
  selectedQuestions: SelectedQuestion[];
  messages: Message[];
  onSendMessage: (content: string) => void;
  onClearSelection: () => void;
  isLoading: boolean;
  onRemoveQuestion?: (id: string) => void;
}

export default function ChatInterface({
  selectedQuestions,
  messages,
  onSendMessage,
  onClearSelection,
  isLoading,
  onRemoveQuestion,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [showingImage, setShowingImage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && selectedQuestions.length === 0) || isLoading) return;
    
    onSendMessage(input);
    setInput("");
  };

  // Get first selected question with image for display
  const questionWithImage = selectedQuestions.find(q => q.imageUrl);

  return (
    <div className="flex flex-col h-full bg-black relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900/40 via-black to-black pointer-events-none" />
      
      {/* Context Header with Question Image Preview */}
      <AnimatePresence>
        {selectedQuestions.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-zinc-900/50 border-b border-zinc-800 backdrop-blur-md z-10"
          >
            <div className="p-3 flex items-start gap-4 text-left">
              {/* Question Image Thumbnail */}
              {questionWithImage?.imageUrl && (
                <div 
                  onClick={() => setShowingImage(questionWithImage.imageUrl || null)}
                  className="relative w-16 h-16 rounded-lg overflow-hidden border border-zinc-700 cursor-pointer hover:border-red-500 transition-colors shrink-0"
                >
                  <img 
                    src={questionWithImage.imageUrl} 
                    alt="Question" 
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent flex items-end justify-center pb-1">
                    <ImageIcon className="w-3 h-3 text-white" />
                  </div>
                </div>
              )}
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-red-500">BAĞLAM ({selectedQuestions.length})</span>
                  <button onClick={onClearSelection} className="p-1 hover:bg-zinc-800 rounded text-zinc-500 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                  <div className="flex flex-wrap gap-4">
                    {Object.entries(selectedQuestions.reduce((acc, q) => {
                       const parts = q.title.split(' - ');
                       const testName = parts.length >= 3 ? parts[1] : 'Genel';
                       if (!acc[testName]) acc[testName] = [];
                       acc[testName].push(q);
                       return acc;
                    }, {} as Record<string, typeof selectedQuestions>)).map(([testName, questions]) => (
                      <div key={testName} className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">{testName}</span>
                        <div className="flex flex-wrap gap-1">
                          {questions.map((q) => {
                             const qName = q.title.split(' - ').pop() || q.title;
                             return (
                              <div key={q.id} className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-zinc-800 rounded text-zinc-400 border border-zinc-700">
                                  <span>{qName}</span>
                                  {onRemoveQuestion && (
                                    <button 
                                      onClick={() => onRemoveQuestion(q.id)}
                                      className="hover:text-red-400 transition-colors"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Image Modal */}
      <AnimatePresence>
        {showingImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowingImage(null)}
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8 cursor-pointer"
          >
            <motion.img 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={showingImage} 
              alt="Question" 
              className="max-w-full max-h-full object-contain rounded-2xl border border-zinc-800"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 relative z-0" ref={scrollRef}>
        {messages.length === 0 && selectedQuestions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-600 opacity-50">
            <Sparkles className="w-12 h-12 mb-4" />
            <p className="font-mono text-sm">Bir soru seçin veya sohbete başlayın...</p>
          </div>
        ) : (
          messages.filter(m => !m.hidden).map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-start gap-4 ${msg.role === "user" ? "flex-row-reverse text-right" : "text-left"}`}
            >
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center shrink-0 border
                ${msg.role === "model" ? "bg-black border-red-900/50 text-red-500" : "bg-zinc-800 border-zinc-700 text-zinc-400"}
              `}>
                {msg.role === "model" ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>
              <div className={`
                max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed
                ${msg.role === "model" 
                    ? "bg-zinc-900/50 border border-zinc-800 text-zinc-300" 
                    : "bg-white text-black font-medium"}
              `}>
                 {/* Show attached images if any */}
                {(msg.metadata?.questionImageUrls || msg.metadata?.questionImageUrl) && (
                  <div className="flex flex-col gap-3 mb-3">
                    {msg.metadata.questionImageUrls ? (
                      msg.metadata.questionImageUrls.map((url, idx) => (
                        <div key={idx} className="p-1 rounded-lg bg-black/40 border border-white/5 overflow-hidden group/img shrink-0">
                          <img 
                            src={url}
                            alt={`Question ${idx + 1}`}
                            className="max-w-full h-auto rounded-md cursor-zoom-in transition-transform group-hover/img:scale-[1.02]"
                            onClick={() => setShowingImage(url)}
                          />
                        </div>
                      ))
                    ) : (
                      <div className="p-1 rounded-lg bg-black/40 border border-white/5 overflow-hidden group/img shrink-0">
                        <img 
                          src={msg.metadata.questionImageUrl}
                          alt="Question"
                          className="max-w-full h-auto rounded-md cursor-zoom-in transition-transform group-hover/img:scale-[1.02]"
                          onClick={() => setShowingImage(msg.metadata.questionImageUrl || null)}
                        />
                      </div>
                    )}
                  </div>
                )}
                {msg.content && (
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {msg.content
                        .replace(/\\\(/g, '$')
                        .replace(/\\\)/g, '$')
                        .replace(/\\\[/g, '$$$')
                        .replace(/\\\]/g, '$$$')
                        .replace(/\\\$/g, '$')
                      }
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </motion.div>
          ))
        )}
        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-black border border-red-900/50 flex items-center justify-center shrink-0 text-red-500">
              <Bot className="w-4 h-4" />
            </div>
            <div className="flex gap-1 h-8 items-center pl-2">
              <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
              <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce"></span>
            </div>
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-900 bg-black z-10">
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-4xl mx-auto">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={selectedQuestions.length > 0 ? "Bu sorular hakkında soru sor..." : "Mesajınızı yazın..."}
            className="flex-1 bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-red-900 focus:border-red-900/50 transition-all font-mono text-sm placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={isLoading || (!input && selectedQuestions.length === 0)}
            className="bg-white text-black rounded-xl px-4 py-3 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
