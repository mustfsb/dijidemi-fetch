"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/db/supabase";
import { Clock, MessageSquare, ChevronRight, Plus, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

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

  // Handle optimistic updates
  useEffect(() => {
    if (optimisticSession) {
      setSessions(prev => {
        // Prevent duplicates
        if (prev.find(s => s.id === optimisticSession.id)) return prev;
        return [optimisticSession, ...prev];
      });
    } else {
      // If optimisticSession becomes null, remove any temp_ items that might have been added
      // as they should now be replaced by real DB records from fetchHistory
      setSessions(prev => prev.filter(s => !s.id.toString().startsWith('temp_')));
    }
  }, [optimisticSession]);

  useEffect(() => {
    if (userId) {
      fetchHistory();
    }
  }, [userId, lastUpdate]); // Removed currentSessionId from dependency to prevent re-fetching on select

  const fetchHistory = async () => {
    if (!userId) return;
    
    // Don't set loading true here if we already have data, to prevent flashing
    if (sessions.length === 0) setLoading(true);
    
    const { data, error } = await supabase
      .from("ai_log")
      .select("id, session_title, title, user_prompt, image_ids, created_at")
      .eq("username", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    
    setLoading(false);

    if (error) {
        console.error("Fetch History Error:", error);
        return;
    }

    if (data) {
        setSessions(prev => {
            const dataIds = new Set(data.map(d => d.id));
            const dataPrompts = new Set(data.map(d => d.user_prompt.trim()));
            
            // Filter existing sessions: remove if in dataIds or if it's a temp item matching a real prompt
            const uniqueOld = prev.filter(p => {
                const isTemp = p.id.toString().startsWith('temp_');
                if (dataIds.has(p.id)) return false;
                if (isTemp && dataPrompts.has(p.user_prompt.trim())) return false;
                return true; // Keep everything else (including other temp items and other real items not in the recent fetch)
            });
            
            return [...uniqueOld, ...data].sort((a, b) => 
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
        });
    }
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
    e.stopPropagation(); // Don't trigger session selection
    
    if (!confirm("Bu sohbeti silmek istediğinize emin misiniz?")) return;

    try {
      const { error } = await supabase
        .from("ai_log")
        .delete()
        .eq("id", sessionId);

      if (error) throw error;

      // Update local state
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      
      // If current session was deleted, clear it
      if (currentSessionId === sessionId) {
        onSelectSession("");
      }
    } catch (err) {
      console.error("Delete Error:", err);
      alert("Sohbet silinirken bir hata oluştu.");
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950 border-l border-zinc-900 overflow-hidden">
      <div className="p-4 border-b border-zinc-900 flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-400 tracking-wider uppercase flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Geçmiş
        </h2>
        <div className="flex gap-1">
            <button
            onClick={handleLocalNewSession}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors"
            title="Yeni Sohbet"
            >
            <Plus className="w-4 h-4" />
            </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-zinc-600 font-mono text-xs">Yükleniyor...</div>
        ) : !userId ? (
          <div className="p-8 text-center text-zinc-600 font-mono text-xs">
            Oturum başlatılamadı
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-zinc-600 font-mono text-xs">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            Henüz geçmiş yok.<br />Bir görüşme başlatın!
          </div>
        ) : (
          <div className="divide-y divide-zinc-900/50">
            {sessions.map((session, i) => (
              <motion.button
                key={session.id}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => onSelectSession(session.id)}
                className={`
                  w-full text-left p-4 hover:bg-zinc-900 transition-all group relative
                  ${currentSessionId === session.id ? "bg-zinc-900" : ""}
                `}
              >
                {/* Thumbnail */}
                <div className="flex gap-3">
                  {session.image_ids ? (
                    <div className="w-10 h-10 rounded-lg overflow-hidden border border-zinc-800 shrink-0">
                      <img 
                        src={session.image_ids.split(',')[0]} 
                        alt="" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                      <MessageSquare className="w-4 h-4 text-zinc-700" />
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${currentSessionId === session.id ? "text-white" : "text-zinc-400"}`}>
                      {session.title || session.session_title || "Başlıksız Görüşme"}
                    </div>
                    <div className={`text-[10px] font-mono ${currentSessionId === session.id ? "text-red-500" : "text-zinc-600"}`}>
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
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-600" />
                )}
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
