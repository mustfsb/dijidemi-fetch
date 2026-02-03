"use client";

import { useState, useEffect } from "react";
import { Search, Clock, User, MessageSquare, Bot, ChevronRight, Filter, AlertCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface AILog {
  id: string;
  created_at: string;
  username: string;
  session_title: string | null;
  user_prompt: string | null;
  ai_response: string | null;
  sender: string | null;
  title: string | null;
}

export default function AILogsPage() {
  const [logs, setLogs] = useState<AILog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLog, setSelectedLog] = useState<AILog | null>(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/ai-logs');
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter(log => 
    log.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.user_prompt?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.session_title?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tighter">AI GÖRÜŞME KAYITLARI</h2>
          <p className="text-zinc-500 font-mono text-sm">Yapay zeka etkileşimlerini takip et</p>
        </div>
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-red-500 transition-colors" />
          <input 
            type="text"
            placeholder="Kullanıcı veya içerik ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500 w-full md:w-64 transition-all"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Logs List */}
        <div className="lg:col-span-12 xl:col-span-5 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 bg-zinc-950/50 border border-zinc-900 rounded-3xl">
              <Loader2 className="w-8 h-8 text-red-600 animate-spin mb-4" />
              <p className="text-zinc-500 font-mono text-xs">Kayıtlar yükleniyor...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 bg-zinc-950/50 border border-zinc-900 rounded-3xl">
              <AlertCircle className="w-8 h-8 text-zinc-800 mb-4" />
              <p className="text-zinc-500 font-mono text-xs">Arama kriterlerine uygun kayıt bulunamadı.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLogs.map((log) => (
                <motion.div
                  layout
                  key={log.id}
                  onClick={() => setSelectedLog(log)}
                  className={`
                    p-4 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden
                    ${selectedLog?.id === log.id 
                      ? "bg-zinc-900 border-zinc-700 ring-1 ring-red-500/30" 
                      : "bg-zinc-950/40 border-zinc-900 hover:border-zinc-800 hover:bg-zinc-900/40"}
                  `}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-zinc-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">
                          {log.username || "Anonim"}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-600 flex items-center gap-1.5 uppercase">
                          <Clock className="w-3 h-3" />
                          {new Date(log.created_at).toLocaleString('tr-TR')}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-zinc-800 group-hover:text-zinc-600 transition-all ${selectedLog?.id === log.id ? 'rotate-90 text-red-500' : ''}`} />
                  </div>
                  
                  <div className="mt-3">
                    <p className="text-xs text-zinc-500 line-clamp-2 italic">
                      "{log.user_prompt || "İçerik yok"}"
                    </p>
                  </div>

                  {selectedLog?.id === log.id && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-600" />
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Log Detail */}
        <div className="lg:col-span-12 xl:col-span-7">
          <AnimatePresence mode="wait">
            {selectedLog ? (
              <motion.div
                key={selectedLog.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 md:p-8 space-y-8 sticky top-8"
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-900 pb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                      <User className="w-5 h-5 text-zinc-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white uppercase tracking-tight">Kullanıcı: {selectedLog.username}</h3>
                      <p className="text-xs font-mono text-zinc-500">{new Date(selectedLog.created_at).toLocaleString('tr-TR')}</p>
                    </div>
                  </div>
                  <div className="px-3 py-1 bg-zinc-900 rounded-full border border-zinc-800 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                    ID: {selectedLog.id.split('-')[0]}
                  </div>
                </div>

                {/* Content */}
                <div className="space-y-6">
                  {/* Prompt */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <MessageSquare className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-widest">Kullanıcı Girdisi</span>
                    </div>
                    <div className="p-4 bg-black/40 border border-zinc-900 rounded-2xl text-sm text-zinc-300 leading-relaxed font-medium">
                      {selectedLog.user_prompt}
                    </div>
                  </div>

                  {/* AI Response */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-red-500/70">
                      <Bot className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-widest">AI Yanıtı</span>
                    </div>
                    <div className="p-6 bg-red-950/10 border border-red-900/20 rounded-2xl text-sm text-zinc-200 leading-relaxed font-light prose prose-invert max-w-none shadow-inner whitespace-pre-wrap">
                      {selectedLog.ai_response || "Yanıt oluşturulurken bir hata oluştu veya yanıt boş."}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center bg-zinc-950/30 border border-zinc-900 border-dashed rounded-3xl text-center p-8">
                <div className="w-16 h-16 rounded-full bg-zinc-900/50 flex items-center justify-center mb-4">
                  <MessageSquare className="w-8 h-8 text-zinc-800" />
                </div>
                <h3 className="text-zinc-600 font-bold uppercase tracking-widest">Görüşme Seçin</h3>
                <p className="text-zinc-700 text-sm mt-2 max-w-xs">Detaylarını görmek istediğiniz bir AI görüşmesini listeden seçebilirsiniz.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
