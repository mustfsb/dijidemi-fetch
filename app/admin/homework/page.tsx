"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, BookOpen, ToggleLeft, ToggleRight, Loader2, Edit2, Check, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface Homework {
  id: string;
  homework_identifier: string;
  description: string | null;
  status: 'active' | 'deactive';
  created_at: string;
}

export default function HomeworkPage() {
  const supabase = useMemo(() => createClient(), []);
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(true);
  const [newId, setNewId] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<{ identifier: string; description: string }>({ identifier: "", description: "" });
  const [syncing, setSyncing] = useState(false);
  const [fetchingKtt, setFetchingKtt] = useState(false);

  useEffect(() => {
    fetchHomeworks();
  }, []);

  const fetchHomeworks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("homeworks")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) {
      console.error("Fetch Error:", error);
      toast.error("Ödevler yüklenemedi: " + error.message);
    } else if (data) {
      setHomeworks(data);
    }
    setLoading(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/homework/sync', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.count} yeni ödev eşitlendi`);
        fetchHomeworks();
      } else {
        toast.error("Eşitleme başarısız: " + (data.details || data.error));
      }
    } catch (e: any) {
      toast.error("Eşitleme hatası: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim()) return;
    
    setAdding(true);

    const { data, error } = await supabase
      .from("homeworks")
      .insert([{ 
        homework_identifier: newId,
        description: newDesc || null,
        status: 'active',
        type: 'assignment'
      }])
      .select()
      .single();

    if (error) {
      console.error("Add Error:", error);
      toast.error("Ödev oluşturulamadı: " + error.message);
    } else {
      toast.success("Ödev eklendi");
      setHomeworks([data, ...homeworks]);
      setNewId("");
      setNewDesc("");
    }
    setAdding(false);
  };

  const handleKttAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim()) return;

    setFetchingKtt(true);
    try {
      // 1. Fetch details from Dijidemi
      const res = await fetch(`/api/homework/fetch-test?testId=${newId}`);
      const testData = await res.json();

      if (!testData.success) {
        throw new Error(testData.error || "Test verisi alınamadı");
      }

      const title = testData.title;
      toast.info(`KTT bulundu: ${title}`);

      // 2. Add to Supabase
      const { data, error } = await supabase
        .from("homeworks")
        .insert([{ 
          homework_identifier: newId,
          description: title,
          status: 'active',
          type: 'ktt'
        }])
        .select()
        .single();

      if (error) throw error;

      toast.success("KTT başarıyla eklendi");
      setHomeworks([data, ...homeworks]);
      setNewId("");
      setNewDesc("");
    } catch (err: any) {
      console.error("KTT Add Error:", err);
      toast.error("Hata: " + err.message);
    } finally {
      setFetchingKtt(false);
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'deactive' : 'active';
    
    // Optimistic update
    setHomeworks(homeworks.map(h => h.id === id ? { ...h, status: newStatus as 'active' | 'deactive' } : h));

    const { error } = await supabase
      .from("homeworks")
      .update({ status: newStatus })
      .eq("id", id);

    if (error) {
      console.error("Toggle Error:", error);
      toast.error("Durum güncellenemedi: " + error.message);
      fetchHomeworks(); // Rollback
    }
  };

  const handleEdit = async (id: string) => {
    const { error } = await supabase
      .from("homeworks")
      .update({ 
        homework_identifier: editData.identifier,
        description: editData.description || null
      })
      .eq("id", id);

    if (error) {
      console.error("Edit Error:", error);
      toast.error("Güncelleme başarısız: " + error.message);
    } else {
      toast.success("Güncellendi");
      setHomeworks(homeworks.map(h => h.id === id ? { 
        ...h, 
        homework_identifier: editData.identifier,
        description: editData.description || null
      } : h));
      setEditingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if(!confirm("Bu ödevi silmek istediğinize emin misiniz?")) return;

    const { error } = await supabase
      .from("homeworks")
      .delete()
      .eq("id", id);
      
    if (error) {
      console.error("Delete Error:", error);
      toast.error("Silme başarısız: " + error.message);
    } else {
      toast.success("Silindi");
      setHomeworks(homeworks.filter(h => h.id !== id));
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tighter">ÖDEV YÖNETİMİ</h2>
          <p className="text-zinc-500 font-mono text-sm">Ödev oluştur ve yönet</p>
        </div>
        <button 
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl hover:bg-zinc-800 text-zinc-300 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Eşitleniyor...' : 'API\'den Eşitle'}
        </button>
      </div>

      <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl overflow-hidden backdrop-blur-sm p-6">
        {/* Add Form */}
        <form onSubmit={handleAdd} className="space-y-4 mb-8 pb-8 border-b border-zinc-900">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input 
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="Ödev ID (Örn: 55782)..." 
                className="w-full pl-10 pr-4 py-3 bg-black rounded-xl border border-zinc-800 text-white focus:outline-none focus:ring-1 focus:ring-red-500 transition-all"
              />
            </div>
            <button 
              type="submit"
              disabled={adding || fetchingKtt || !newId}
              className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              EKLE
            </button>
            <button 
              type="button"
              onClick={handleKttAdd}
              disabled={adding || fetchingKtt || !newId}
              className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {fetchingKtt ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4 text-red-500" />}
              KTT EKLE
            </button>
          </div>
          <input 
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Açıklama (Opsiyonel)..." 
            className="w-full px-4 py-2 bg-black rounded-xl border border-zinc-800 text-zinc-400 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 transition-all"
          />
        </form>

        <div className="divide-y divide-zinc-900/50">
          <div className="grid grid-cols-12 gap-4 p-4 text-xs font-mono text-zinc-600 uppercase tracking-widest bg-zinc-900/20 rounded-t-xl">
            <div className="col-span-1">Durum</div>
            <div className="col-span-4">Ödev ID</div>
            <div className="col-span-4">Açıklama</div>
            <div className="col-span-2">Tarih</div>
            <div className="col-span-1 text-right">İşlem</div>
          </div>
          
          <AnimatePresence>
            {loading ? (
              <div className="p-8 text-center text-zinc-500">Yükleniyor...</div>
            ) : homeworks.length === 0 ? (
              <div className="p-8 text-center text-zinc-500">Ödev bulunamadı. Yukarıdan ekleyin!</div>
            ) : (
              homeworks.map((hw) => (
                <motion.div
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  key={hw.id}
                  className={`grid grid-cols-12 gap-4 p-4 items-center transition-colors group ${hw.status === 'active' ? 'bg-zinc-900/10' : 'bg-black opacity-60'}`}
                >
                  {/* Status Toggle */}
                  <div className="col-span-1">
                    <button 
                      onClick={() => toggleStatus(hw.id, hw.status)} 
                      className="relative w-12 h-6 flex items-center rounded-full transition-colors duration-300 focus:outline-none"
                      style={{ backgroundColor: hw.status === 'active' ? '#10b981' : '#27272a' }}
                    >
                      <motion.div
                        layout
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="w-4 h-4 bg-white rounded-full mx-1 shadow-sm"
                        animate={{ x: hw.status === 'active' ? 24 : 0 }}
                      />
                    </button>
                  </div>

                  {/* Homework ID */}
                  <div className="col-span-4">
                    {editingId === hw.id ? (
                      <input
                        value={editData.identifier}
                        onChange={(e) => setEditData({ ...editData, identifier: e.target.value })}
                        className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-white"
                      />
                    ) : (
                      <span className="font-bold text-lg text-white font-mono tracking-tight">
                        {hw.homework_identifier}
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <div className="col-span-4">
                    {editingId === hw.id ? (
                      <input
                        value={editData.description}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                        placeholder="Açıklama..."
                        className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-zinc-400 text-sm"
                      />
                    ) : (
                      <span className="text-sm text-zinc-500">
                        {hw.description || "-"}
                      </span>
                    )}
                  </div>

                  {/* Date */}
                  <div className="col-span-2 text-xs font-mono text-zinc-600">
                    {new Date(hw.created_at).toLocaleDateString()}
                  </div>

                  {/* Actions */}
                  <div className="col-span-1 flex justify-end gap-1">
                    {editingId === hw.id ? (
                      <>
                        <button 
                          onClick={() => handleEdit(hw.id)}
                          className="p-2 text-emerald-500 hover:bg-emerald-500/20 rounded-lg transition-all"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setEditingId(null)}
                          className="p-2 text-zinc-500 hover:bg-zinc-500/20 rounded-lg transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                          onClick={() => {
                            setEditingId(hw.id);
                            setEditData({ identifier: hw.homework_identifier, description: hw.description || "" });
                          }}
                          className="p-2 text-zinc-600 hover:text-white hover:bg-zinc-800 rounded-lg transition-all"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(hw.id)}
                          className="p-2 text-zinc-600 hover:text-red-500 hover:bg-red-950/30 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
