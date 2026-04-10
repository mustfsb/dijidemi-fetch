"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { User, Edit2, Check, X, Search, Trash2, Shield, Clock, Save, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<any | null>(null); // For Modal
  const [searchQuery, setSearchQuery] = useState("");
  const [enrollHours, setEnrollHours] = useState<number>(24);
  const [privateTestLoading, setPrivateTestLoading] = useState<boolean>(true);
  const [privateTestUpdating, setPrivateTestUpdating] = useState<boolean>(false);
  const [privateTestSettings, setPrivateTestSettings] = useState<any | null>(null);
  const [privateTestBindings, setPrivateTestBindings] = useState<any[]>([]);
  const [editingBinding, setEditingBinding] = useState<any | null>(null);

  useEffect(() => {
    fetchUsers();
    fetchPrivateTestData();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch (e) {
      toast.error("Kullanıcılar getirilemedi");
    }
    setLoading(false);
  };

  const fetchPrivateTestData = async () => {
    setPrivateTestLoading(true);
    try {
      const res = await fetch('/api/admin/private-test');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Private-test verileri alınamadı");
      setPrivateTestSettings(data.settings || null);
      setPrivateTestBindings(data.bindings || []);
    } catch (e: any) {
      toast.error(e?.message || "Private-test verileri alınamadı");
    } finally {
      setPrivateTestLoading(false);
    }
  };

  const updateEnrollment = async (isOpen: boolean) => {
    setPrivateTestUpdating(true);
    try {
      const payload: Record<string, unknown> = { is_open: isOpen };
      if (isOpen) payload.duration_hours = enrollHours;

      const res = await fetch('/api/admin/private-test', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kayıt penceresi güncellenemedi");

      setPrivateTestSettings(data.settings || null);
      toast.success(isOpen ? "Kayıt penceresi açıldı" : "Kayıt penceresi kapatıldı");
      await fetchPrivateTestData();
    } catch (e: any) {
      toast.error(e?.message || "Kayıt penceresi güncellenemedi");
    } finally {
      setPrivateTestUpdating(false);
    }
  };

  const handleBindingUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBinding) return;

    setPrivateTestUpdating(true);
    try {
      const res = await fetch('/api/admin/private-test', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_binding',
          binding_id: editingBinding.id,
          user_id: editingBinding.user_id,
          browser_name: editingBinding.browser_name,
          browser_major: Number.parseInt(String(editingBinding.browser_major || 0), 10),
          user_agent: editingBinding.user_agent || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kayıt güncellenemedi");

      toast.success("Private-test kaydı güncellendi");
      setEditingBinding(null);
      await fetchPrivateTestData();
    } catch (e: any) {
      toast.error(e?.message || "Kayıt güncellenemedi");
    } finally {
      setPrivateTestUpdating(false);
    }
  };

  const handleBindingRevoke = async (bindingId: number) => {
    if (!confirm("Bu kaydı sıfırlamak istediğinize emin misiniz? Kullanıcı yeniden kayıt olmalı.")) return;

    setPrivateTestUpdating(true);
    try {
      const res = await fetch('/api/admin/private-test', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revoke_binding',
          binding_id: bindingId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kayıt sıfırlanamadı");

      toast.success("Private-test kaydı sıfırlandı");
      await fetchPrivateTestData();
    } catch (e: any) {
      toast.error(e?.message || "Kayıt sıfırlanamadı");
    } finally {
      setPrivateTestUpdating(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
        const res = await fetch('/api/admin/users', {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                id: editingUser.id,
                updates: { 
                    nickname_credential: editingUser.nickname_credential || null,
                    role: editingUser.role 
                }
            })
        });

        if (!res.ok) throw new Error("Update failed");

        toast.success("Kullanıcı güncellendi");
        setUsers(users.map(u => u.id === editingUser.id ? editingUser : u));
        setEditingUser(null);
    } catch (error) {
        toast.error("Güncelleme başarısız");
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Bu kullanıcıyı silmek istediğinize emin misiniz?")) return;

    const res = await fetch(`/api/admin/users?id=${userId}`, { method: 'DELETE' });
    
    if (!res.ok) {
      toast.error("Silme işlemi başarısız");
    } else {
      toast.success("Kullanıcı silindi");
      setUsers(users.filter(u => u.id !== userId));
    }
  };

  const filteredUsers = users.filter(u => 
    u.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.nickname_credential?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tighter">KULLANICI YÖNETİMİ</h2>
          <p className="text-zinc-500 font-mono text-sm">Giriş ve yetki yönetimi</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Kullanıcı ara..." 
            className="pl-10 pr-4 py-2 bg-zinc-900 rounded-xl border border-zinc-800 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-red-500 w-64"
          />
        </div>
      </div>

      <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 space-y-6 backdrop-blur-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">PRIVATE-TEST KAYIT PENCERESİ</h3>
            <p className="text-zinc-500 text-sm font-mono">
              Yeni kullanıcıların cihaz/tarayıcı kaydı için aç-kapat kontrolü
            </p>
            {privateTestLoading ? (
              <p className="text-zinc-500 text-xs mt-2">Yükleniyor...</p>
            ) : (
              <p className="text-xs mt-2 font-mono">
                Durum:{" "}
                <span className={privateTestSettings?.is_open ? "text-emerald-500" : "text-red-500"}>
                  {privateTestSettings?.is_open ? "AÇIK" : "KAPALI"}
                </span>
                {privateTestSettings?.enrollment_until && (
                  <span className="text-zinc-400">
                    {" "}• Bitiş: {new Date(privateTestSettings.enrollment_until).toLocaleString()}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="enrollHours" className="text-zinc-400">Süre (Saat)</Label>
              <Input
                id="enrollHours"
                type="number"
                min={1}
                value={enrollHours}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  setEnrollHours(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
                }}
                className="w-32 bg-zinc-900 border-zinc-800"
              />
            </div>
            <Button
              onClick={() => updateEnrollment(true)}
              disabled={privateTestUpdating || privateTestLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Kayıt Aç
            </Button>
            <Button
              onClick={() => updateEnrollment(false)}
              disabled={privateTestUpdating || privateTestLoading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Kayıt Kapat
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">Kayıtlı Private-Test Cihazları</h4>
          <div className="overflow-x-auto border border-zinc-900 rounded-2xl">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/40 text-zinc-500 uppercase text-xs tracking-wider">
                <tr>
                  <th className="text-left p-3">Kullanıcı</th>
                  <th className="text-left p-3">User ID</th>
                  <th className="text-left p-3">Tarayıcı</th>
                  <th className="text-left p-3">İlk Kayıt</th>
                  <th className="text-left p-3">Son Görülme</th>
                  <th className="text-right p-3">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/60">
                {privateTestLoading ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-zinc-500 text-center">Yükleniyor...</td>
                  </tr>
                ) : privateTestBindings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-zinc-500 text-center">Henüz kayıtlı cihaz yok.</td>
                  </tr>
                ) : (
                  privateTestBindings.map((binding) => {
                    const user = Array.isArray(binding.users) ? binding.users[0] : binding.users;
                    return (
                      <tr key={binding.id} className="hover:bg-zinc-900/20">
                        <td className="p-3 text-zinc-200">
                          {user?.full_name || user?.username || user?.external_id || "Bilinmeyen"}
                        </td>
                        <td className="p-3 font-mono text-xs text-zinc-400">{binding.user_id}</td>
                        <td className="p-3 text-zinc-300">{binding.browser_name} {binding.browser_major}</td>
                        <td className="p-3 text-zinc-400">{new Date(binding.created_at).toLocaleString()}</td>
                        <td className="p-3 text-zinc-400">{new Date(binding.last_seen_at).toLocaleString()}</td>
                        <td className="p-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditingBinding(binding)}
                              className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                              title="Düzenle"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleBindingRevoke(binding.id)}
                              className="p-2 rounded-lg text-red-500 hover:bg-red-500/20 transition-colors"
                              title="Sıfırla"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Dialog open={!!editingBinding} onOpenChange={(open) => !open && setEditingBinding(null)}>
        <DialogContent className="sm:max-w-lg bg-zinc-950 border-zinc-900 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Private-Test Kaydı Düzenle</DialogTitle>
          </DialogHeader>
          {editingBinding && (
            <form onSubmit={handleBindingUpdate} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>User ID</Label>
                <Input
                  value={editingBinding.user_id || ''}
                  onChange={(e) => setEditingBinding({ ...editingBinding, user_id: e.target.value })}
                  className="bg-zinc-900 border-zinc-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tarayıcı</Label>
                  <Input
                    value={editingBinding.browser_name || ''}
                    onChange={(e) => setEditingBinding({ ...editingBinding, browser_name: e.target.value })}
                    className="bg-zinc-900 border-zinc-800"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Major Versiyon</Label>
                  <Input
                    type="number"
                    min={0}
                    value={editingBinding.browser_major ?? 0}
                    onChange={(e) => setEditingBinding({ ...editingBinding, browser_major: Number.parseInt(e.target.value || '0', 10) })}
                    className="bg-zinc-900 border-zinc-800"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>User-Agent (Opsiyonel)</Label>
                <Input
                  value={editingBinding.user_agent || ''}
                  onChange={(e) => setEditingBinding({ ...editingBinding, user_agent: e.target.value })}
                  className="bg-zinc-900 border-zinc-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setEditingBinding(null)}>
                  İptal
                </Button>
                <Button type="submit" className="bg-red-600 hover:bg-red-700 text-white" disabled={privateTestUpdating}>
                  Kaydı Güncelle
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl overflow-hidden backdrop-blur-sm">
        <div className="grid grid-cols-12 gap-4 p-4 text-xs font-mono text-zinc-600 uppercase tracking-widest bg-zinc-900/20">
          <div className="col-span-3">Kullanıcı</div>
          <div className="col-span-2">Rol</div>
          <div className="col-span-3">Takma Ad</div>
          <div className="col-span-2">Son Giriş</div>
          <div className="col-span-2 text-right">İşlemler</div>
        </div>
        
        <div className="divide-y divide-zinc-900/50">
          {loading ? (
            <div className="p-8 text-center text-zinc-500 font-mono">Yükleniyor...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 font-mono">Kullanıcı bulunamadı.</div>
          ) : (
            filteredUsers.map((user) => (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                key={user.id} 
                className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-zinc-900/30 transition-colors"
              >
                {/* User Info */}
                <div className="col-span-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 font-bold border border-zinc-700">
                    {user.username?.[0]?.toUpperCase() || "U"}
                  </div>
                  <div>
                    <div className="font-bold text-zinc-200">{user.full_name || user.username || "Bilinmeyen"}</div>
                    <div className="text-xs text-zinc-500 font-mono">{user.external_id || user.id.slice(0, 8)}</div>
                  </div>
                </div>

                {/* Role */}
                <div className="col-span-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-bold border ${
                      user.role === 'admin' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                    }`}>
                      {user.role === 'admin' && <Shield className="w-3 h-3" />}
                      {user.role?.toUpperCase() || "KULLANICI"}
                    </span>
                </div>

                {/* Nickname */}
                <div className="col-span-3">
                    <span className={`font-mono text-sm ${user.nickname_credential ? "text-emerald-500" : "text-zinc-700"}`}>
                      {user.nickname_credential || "-"}
                    </span>
                </div>

                {/* Last Login */}
                <div className="col-span-2 flex items-center gap-2 text-xs text-zinc-500 font-mono">
                  <Clock className="w-3 h-3" />
                  {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : "Hiç"}
                </div>

                {/* Actions */}
                <div className="col-span-2 flex justify-end gap-2">
                      <button 
                        onClick={() => setEditingUser(user)} 
                        className="p-2 hover:bg-zinc-500/20 text-zinc-500 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(user.id)} className="p-2 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Edit Modal */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-900 text-zinc-100">
            <DialogHeader>
                <DialogTitle>Kullanıcı Düzenle</DialogTitle>
            </DialogHeader>
            {editingUser && (
                <form onSubmit={handleUpdate} className="space-y-4 pt-4">
                    <div className="space-y-2">
                        <Label>Kullanıcı Adı</Label>
                        <Input disabled value={editingUser.username || ''} className="bg-zinc-900 border-zinc-800" />
                    </div>
                    
                    <div className="space-y-2">
                        <Label>Takma Ad (Opsiyonel)</Label>
                        <Input 
                            value={editingUser.nickname_credential || ''} 
                            onChange={e => setEditingUser({...editingUser, nickname_credential: e.target.value})}
                            className="bg-zinc-900 border-zinc-800" 
                            placeholder="Giriş ekranında görünecek isim"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Yetki Rolü</Label>
                        <select 
                            value={editingUser.role || 'user'}
                            onChange={e => setEditingUser({...editingUser, role: e.target.value})}
                            className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <option value="user">Kullanıcı (Standart)</option>
                            <option value="admin">Yönetici (Admin)</option>
                        </select>
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <Button type="button" variant="ghost" onClick={() => setEditingUser(null)}>İptal</Button>
                        <Button type="submit" className="bg-red-600 hover:bg-red-700 text-white">Kaydet</Button>
                    </div>
                </form>
            )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
