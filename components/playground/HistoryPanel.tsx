"use client";

import { useEffect, useState } from "react";
import { Clock, MessageSquare, ChevronRight, Plus, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { authFetch } from "@/lib/tokenManager";

interface HistoryItem {
  id: string;
  session_title: string;
  title?: string;
  user_prompt: string;
  image_ids: string | null;
  created_at: string;
}

interface HistoryPanelProps {
  userId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession?: () => void;
  currentSessionId: string | null;
  optimisticSession?: HistoryItem | null;
  lastUpdate?: number;
}

export default function HistoryPanel({ userId, onSelectSession, onNewSession, currentSessionId, lastUpdate, optimisticSession }: HistoryPanelProps) {
  const [sessions, setSessions] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (optimisticSession) {
      setSessions(prev => {
        if (prev.find(s => s.id === optimisticSession.id)) return prev;
        return [optimisticSession, ...prev];
      });
    } else {
      setSessions(prev => prev.filter(s => !s.id.toString().startsWith('temp_')));
    }
  }, [optimisticSession]);

  useEffect(() => {
    if (userId) {
      fetchHistory();
    }
  }, [userId, lastUpdate]);

  const fetchHistory = async () => {
    if (!userId) return;

    if (sessions.length === 0) setLoading(true);

    const res = await authFetch('/api/playground/history?limit=50');
    const payload = await res.json();
    const data = payload?.sessions;

    setLoading(false);

    if (!res.ok || !Array.isArray(data)) {
        console.error("Fetch History Error:", payload?.error || 'Unknown error');
        return;
    }

    setSessions(prev => {
        const dataIds = new Set(data.map((d: HistoryItem) => d.id));
        const dataPrompts = new Set(data.map((d: HistoryItem) => d.user_prompt.trim()));

        const uniqueOld = prev.filter(p => {
            const isTemp = p.id.toString().startsWith('temp_');
            if (dataIds.has(p.id)) return false;
            if (isTemp && dataPrompts.has(p.user_prompt.trim())) return false;
            return true;
        });

        return [...uniqueOld, ...data].sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
    });
  };

  const handleLocalNewSession = () => {
    if (onNewSession) {
      onNewSession();
    } else {
      onSelectSession("");
      window.location.reload();
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();

    if (!confirm("Bu sohbeti silmek istediğinize emin misiniz?")) return;

    try {
      const res = await authFetch(`/api/playground/history?id=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Delete failed');

      setSessions(prev => prev.filter(s => s.id !== sessionId));

      if (currentSessionId === sessionId) {
        onSelectSession("");
      }
    } catch (err) {
      console.error("Delete Error:", err);
      alert("Sohbet silinirken bir hata oluştu.");
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] border-l border-[#2a2a2a] overflow-hidden">
      <div className="p-4 border-b border-[#2a2a2a] flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-400 tracking-wider uppercase flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Geçmiş
        </h2>
        <button
          onClick={handleLocalNewSession}
          className="p-1.5 rounded-lg hover:bg-[#1e1e1e] text-zinc-500 hover:text-white transition-colors"
          title="Yeni Sohbet"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto playground-scroll">
        {loading ? (
          <div className="p-8 text-center text-zinc-600 text-xs">Yükleniyor...</div>
        ) : !userId ? (
          <div className="p-8 text-center text-zinc-600 text-xs">
            Oturum başlatılamadı
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-zinc-600 text-xs">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            Henüz geçmiş yok.<br />Bir görüşme başlatın!
          </div>
        ) : (
          <div className="divide-y divide-[#2a2a2a]/50">
            {sessions.map((session, i) => (
              <motion.button
                key={session.id}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => onSelectSession(session.id)}
                className={`
                  w-full text-left p-4 transition-all duration-150 group relative
                  hover:bg-[#1e1e1e] hover:-translate-y-px
                  ${currentSessionId === session.id ? "bg-[#1e1e1e]" : ""}
                `}
              >
                <div className="flex gap-3">
                  {session.image_ids ? (
                    <div className="w-10 h-10 rounded-lg overflow-hidden border border-[#2a2a2a] shrink-0">
                      <img
                        src={session.image_ids.split(',')[0]}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-[#141414] border border-[#2a2a2a] flex items-center justify-center shrink-0">
                      <MessageSquare className="w-4 h-4 text-zinc-700" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${currentSessionId === session.id ? "text-white" : "text-zinc-400"}`}>
                      {session.title || session.session_title || "Başlıksız Görüşme"}
                    </div>
                    <div className={`text-[10px] ${currentSessionId === session.id ? "text-red-500" : "text-zinc-600"}`}>
                      {new Date(session.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => handleDeleteSession(e, session.id)}
                      className="p-1.5 rounded-md text-zinc-600 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                      title="Sohbeti Sil"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity self-center" />
                  </div>
                </div>

                {currentSessionId === session.id && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#dc2828]" />
                )}
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
