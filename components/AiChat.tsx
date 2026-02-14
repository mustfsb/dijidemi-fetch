'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, X, Loader2, User } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css'; // Import KaTeX styles


interface Message {
    id: string;
    role: 'user' | 'ai';
    content: string;
    timestamp: Date;
}

interface AiChatProps {
    initialMessage?: string;
    questionContext: {
        bookId: string;
        testId: string;
        questionNumber: string;
        imageUrl?: string;
    };
    onClose: () => void;
}

export default function AiChat({ initialMessage, questionContext, onClose }: AiChatProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (initialMessage) {
            setMessages([
                {
                    id: 'init-1',
                    role: 'ai',
                    content: initialMessage,
                    timestamp: new Date()
                }
            ]);
        } else {
            // If no initial message yet, show "Soru Çözülüyor..." placeholder or ensure loading is handled by parent/props
            setMessages([
                {
                    id: 'loading-1',
                    role: 'ai',
                    content: '🔍 **Soru Çözülüyor...**\n\nSoru analiz ediliyor...',
                    timestamp: new Date()
                }
            ]);
        }
    }, [initialMessage]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || loading) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        try {
            const response = await fetch('/api/ai/solve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'chat',
                    history: [...messages, userMsg].map(m => ({
                        role: m.role === 'ai' ? 'model' : 'user',
                        parts: [{ text: m.content }]
                    })),
                    questionContext
                })
            });
            const data = await response.json();

            if (data.reply) {
                const aiMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'ai',
                    content: data.reply,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, aiMsg]);
            } else {
                // Error handling in chat
                const errorMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'ai',
                    content: 'Üzgünüm, bir hata oluştu: ' + (data.error || 'Bilinmeyen hata'),
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, errorMsg]);
            }

        } catch (error) {
            const errorMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'ai',
                content: 'Bağlantı hatası.',
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-[500px] border rounded-xl bg-card shadow-lg overflow-hidden mt-4 animate-in fade-in slide-in-from-top-4">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b bg-muted/40 px-4">
                <div className="flex items-center gap-2">
                    <div className="bg-red-500/10 p-1.5 rounded-lg">
                        <Bot className="w-5 h-5 text-red-500" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-sm">AI Asistan</h3>
                        <p className="text-[10px] text-muted-foreground">Gemini 3 Flash Preview</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                    <X className="w-4 h-4" />
                </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-dots-pattern">
                {/* Show Question Image Context if available */}
                {questionContext?.imageUrl && (
                    <div className="mb-4 p-2 border rounded-lg bg-background w-fit max-w-[200px] opacity-70 hover:opacity-100 transition-opacity">
                        <p className="text-[10px] text-muted-foreground mb-1 text-center">Analiz Edilen Soru</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={questionContext.imageUrl} alt="Soru" className="w-full h-auto rounded" />
                    </div>
                )}

                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={cn(
                            "flex gap-3 max-w-[85%]",
                            msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                        )}
                    >
                        <div className={cn(
                            "rounded-full flex items-center justify-center flex-shrink-0 transition-all",
                            msg.role === 'user' ? "w-8 h-8 bg-primary text-primary-foreground" : "w-0 h-0 p-0 overflow-hidden opacity-0", // Hide AI avatar completely
                            msg.id === 'loading-1' && "w-8 h-8 bg-transparent overflow-visible opacity-100" // Show only for loading
                        )}>
                            {msg.role === 'user' ? (
                                <User className="w-4 h-4" />
                            ) : msg.id === 'loading-1' ? (
                                <Loader2 className="w-5 h-5 text-red-500 animate-spin" />
                            ) : msg.id === 'loading-1' ? (
                                <Loader2 className="w-5 h-5 text-red-500 animate-spin" />
                            ) : (
                                // No icon for AI response as requested ("2. robot resmi kullanma")
                                null
                            )}
                        </div>
                        <div
                            className={cn(
                                "p-3 rounded-2xl text-sm shadow-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none break-words",
                                msg.role === 'user'
                                    ? "bg-primary text-primary-foreground rounded-tr-none px-4"
                                    : "bg-muted rounded-tl-none border"
                            )}
                        >
                            <ReactMarkdown
                                remarkPlugins={[remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                            >
                                {msg.content
                                    .replace(/\\\(/g, '$') // Replace \( with $
                                    .replace(/\\\)/g, '$') // Replace \) with $
                                    .replace(/\\\[/g, '$$$') // Replace \[ with $$
                                    .replace(/\\\]/g, '$$$') // Replace \] with $$
                                    .replace(/\\\$/g, '$') // Unescape \$ to $
                                }
                            </ReactMarkdown>
                        </div>
                    </div>
                ))}

                {loading && (
                    <div className="flex gap-3 mr-auto max-w-[85%]">
                        <div className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center flex-shrink-0">
                            <Bot className="w-4 h-4" />
                        </div>
                        <div className="bg-muted rounded-2xl rounded-tl-none p-4 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                            <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                            <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t bg-background">
                <div className="relative flex items-end gap-2">
                    <Textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Soruyu anlamadığın yerleri sor..."
                        className="min-h-[50px] max-h-[120px] resize-none pr-12 py-3 bg-muted/50 border-0 focus-visible:ring-1"
                    />
                    <Button
                        size="icon"
                        onClick={handleSend}
                        disabled={!input.trim() || loading}
                        className={cn(
                            "absolute right-2 bottom-2 h-8 w-8 transition-colors",
                            input.trim() ? "bg-red-500 hover:bg-red-600 text-white" : "bg-muted-foreground/20"
                        )}
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
