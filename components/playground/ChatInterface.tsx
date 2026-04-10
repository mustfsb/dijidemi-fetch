"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Bot, X, Image as ImageIcon, Copy, ThumbsUp, ThumbsDown, ChevronDown } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark-dimmed.css';
import CodeBlock from './CodeBlock';

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
  isStreaming?: boolean;
  streamingMessageId?: string | null;
  onRemoveQuestion?: (id: string) => void;
}

const SUGGESTIONS = [
  "Bu soruyu adım adım çöz",
  "Konuyu baştan anlat",
  "Çözüm yöntemlerini karşılaştır",
  "Benzer soru örnekleri göster",
];

function normalizeLatex(text: string) {
  return text
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
    .replace(/\\\$/g, '$');
}

const codeBlockComponents = {
  code({ inline, className, children, ...props }: any) {
    return (
      <CodeBlock inline={inline} className={className}>
        {children}
      </CodeBlock>
    );
  },
};

export default function ChatInterface({
  selectedQuestions,
  messages,
  onSendMessage,
  onClearSelection,
  isLoading,
  isStreaming = false,
  streamingMessageId = null,
  onRemoveQuestion,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [showingImage, setShowingImage] = useState<string | null>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll logic
  useEffect(() => {
    if (!userScrolledUp && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, isStreaming, userScrolledUp]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setUserScrolledUp(distanceFromBottom > 50);
    setShowScrollBtn(distanceFromBottom > 200);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setUserScrolledUp(false);
    }
  }, []);

  // Reset scroll tracking when new message is sent
  useEffect(() => {
    if (isLoading || isStreaming) {
      setUserScrolledUp(false);
    }
  }, [isLoading, isStreaming]);

  // Auto-expand textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 160);
      textareaRef.current.style.height = `${Math.max(44, newHeight)}px`;
    }
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!input.trim() && selectedQuestions.length === 0) || isLoading || isStreaming) return;
    onSendMessage(input);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = '44px';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCopyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const hasContent = input.trim().length > 0 || selectedQuestions.length > 0;
  const isDisabled = isLoading || isStreaming;

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] relative playground-chat">
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
              className="max-w-full max-h-full object-contain rounded-2xl border border-[#2a2a2a]"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages area */}
      <div
        className="flex-1 overflow-y-auto playground-scroll relative z-0"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        <div className="max-w-[720px] mx-auto px-4 py-6 space-y-5">
          {messages.length === 0 && selectedQuestions.length === 0 ? (
            /* Empty state */
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center">
              <Bot className="w-10 h-10 text-zinc-600 mb-4" />
              <p className="text-lg text-zinc-400 mb-6">
                Bir soru seçin veya sohbete başlayın
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="px-4 py-2 rounded-full border border-[#2a2a2a] text-sm text-zinc-400 hover:bg-[#1e1e1e] hover:text-zinc-200 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.filter(m => !m.hidden).map((msg) => {
              const isStreamingThis = isStreaming && msg.id === streamingMessageId;
              const isAI = msg.role === "model";
              const isCompleted = isAI && !isStreamingThis;

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className={`flex ${isAI ? 'justify-start' : 'justify-end'}`}
                >
                  {isAI ? (
                    /* AI message — bare, with small Bot icon */
                    <div className="flex items-start gap-3 max-w-[85%] group">
                      <Bot className="w-6 h-6 text-red-500/70 shrink-0 mt-1" />
                      <div className="min-w-0 flex-1">
                        {/* Image attachments */}
                        {(msg.metadata?.questionImageUrls || msg.metadata?.questionImageUrl) && (
                          <div className="flex flex-col gap-3 mb-3">
                            {msg.metadata.questionImageUrls ? (
                              msg.metadata.questionImageUrls.map((url, idx) => (
                                <div key={idx} className="rounded-lg border border-[#2a2a2a] overflow-hidden group/img shrink-0 max-w-sm">
                                  <img
                                    src={url}
                                    alt={`Question ${idx + 1}`}
                                    className="max-w-full h-auto cursor-zoom-in transition-transform group-hover/img:scale-[1.02]"
                                    onClick={() => setShowingImage(url)}
                                  />
                                </div>
                              ))
                            ) : (
                              <div className="rounded-lg border border-[#2a2a2a] overflow-hidden group/img shrink-0 max-w-sm">
                                <img
                                  src={msg.metadata.questionImageUrl}
                                  alt="Question"
                                  className="max-w-full h-auto cursor-zoom-in transition-transform group-hover/img:scale-[1.02]"
                                  onClick={() => setShowingImage(msg.metadata!.questionImageUrl || null)}
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Content */}
                        {msg.content && (
                          <div className="prose prose-sm prose-invert max-w-none text-base leading-[1.7] text-zinc-200">
                            <ReactMarkdown
                              remarkPlugins={[remarkMath, remarkGfm]}
                              rehypePlugins={[rehypeKatex, rehypeHighlight]}
                              components={codeBlockComponents}
                            >
                              {normalizeLatex(msg.content)}
                            </ReactMarkdown>
                          </div>
                        )}

                        {/* Streaming dot */}
                        {isStreamingThis && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-dot ml-1 mt-2" />
                        )}

                        {/* Action buttons — only on completed AI messages */}
                        {isCompleted && msg.content && (
                          <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            <button
                              onClick={() => handleCopyMessage(msg.content)}
                              className="p-1.5 rounded-md hover:bg-[#1e1e1e] text-zinc-500 hover:text-zinc-300 transition-colors"
                              title="Kopyala"
                            >
                              <Copy className="w-[18px] h-[18px]" />
                            </button>
                            <button
                              className="p-1.5 rounded-md hover:bg-[#1e1e1e] text-zinc-500 hover:text-zinc-300 transition-colors"
                              title="Beğen"
                            >
                              <ThumbsUp className="w-[18px] h-[18px]" />
                            </button>
                            <button
                              className="p-1.5 rounded-md hover:bg-[#1e1e1e] text-zinc-500 hover:text-zinc-300 transition-colors"
                              title="Beğenme"
                            >
                              <ThumbsDown className="w-[18px] h-[18px]" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* User message — right-aligned bubble */
                    <div className="max-w-[80%]">
                      {/* Image attachments */}
                      {(msg.metadata?.questionImageUrls || msg.metadata?.questionImageUrl) && (
                        <div className="flex flex-col gap-3 mb-3">
                          {msg.metadata.questionImageUrls ? (
                            msg.metadata.questionImageUrls.map((url, idx) => (
                              <div key={idx} className="rounded-lg border border-[#2a2a2a] overflow-hidden group/img shrink-0 max-w-sm ml-auto">
                                <img
                                  src={url}
                                  alt={`Question ${idx + 1}`}
                                  className="max-w-full h-auto cursor-zoom-in transition-transform group-hover/img:scale-[1.02]"
                                  onClick={() => setShowingImage(url)}
                                />
                              </div>
                            ))
                          ) : (
                            <div className="rounded-lg border border-[#2a2a2a] overflow-hidden group/img shrink-0 max-w-sm ml-auto">
                              <img
                                src={msg.metadata.questionImageUrl}
                                alt="Question"
                                className="max-w-full h-auto cursor-zoom-in transition-transform group-hover/img:scale-[1.02]"
                                onClick={() => setShowingImage(msg.metadata!.questionImageUrl || null)}
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="bg-white/5 rounded-[16px_16px_4px_16px] px-4 py-3 text-zinc-200 text-sm leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}

          {/* Loading indicator (pre-stream, image resolution phase) */}
          {isLoading && !isStreaming && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3">
              <Bot className="w-6 h-6 text-red-500/70 shrink-0 mt-1" />
              <div className="flex gap-1 h-8 items-center">
                <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce" />
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Scroll to bottom button */}
      <AnimatePresence>
        {showScrollBtn && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={scrollToBottom}
            className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 w-9 h-9 rounded-full bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-[#252525] transition-colors shadow-lg"
          >
            <ChevronDown className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Input area */}
      <div className="p-4 bg-[#0a0a0a] z-10">
        <div className="max-w-[720px] mx-auto">
          {/* Context chips */}
          <AnimatePresence>
            {selectedQuestions.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-2 overflow-hidden"
              >
                <div className="flex flex-wrap gap-1.5">
                  {selectedQuestions.map((q) => {
                    const shortName = q.title.split(' - ').pop() || q.title;
                    return (
                      <span
                        key={q.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1e1e1e] text-zinc-400 text-xs rounded-full"
                      >
                        {shortName}
                        {onRemoveQuestion && (
                          <button
                            onClick={() => onRemoveQuestion(q.id)}
                            className="hover:text-red-400 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    );
                  })}
                  <button
                    onClick={onClearSelection}
                    className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Temizle
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input container */}
          <div className={`
            flex items-end gap-2 border rounded-[20px] px-4 py-2 transition-all duration-200
            ${isDisabled ? 'border-[#2a2a2a] opacity-60' : 'border-[#2a2a2a] focus-within:border-[#dc2828]/30 focus-within:shadow-[0_0_0_1px_rgba(220,40,40,0.1)]'}
          `}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isDisabled}
              placeholder={selectedQuestions.length > 0 ? "Bu sorular hakkında soru sor..." : "Mesajınızı yazın..."}
              rows={1}
              className="flex-1 bg-transparent text-zinc-200 text-sm resize-none focus:outline-none placeholder:text-zinc-600 py-1 min-h-[28px] max-h-[160px]"
              style={{ height: '28px' }}
            />
            <button
              onClick={() => handleSubmit()}
              disabled={isDisabled || !hasContent}
              className={`
                w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors
                ${hasContent && !isDisabled
                  ? 'bg-[#dc2828] text-white hover:bg-[#b91c1c]'
                  : 'bg-[#2a2a2a] text-zinc-600'}
              `}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
