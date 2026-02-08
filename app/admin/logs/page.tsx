"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";

type LogFilter = "ALL" | "LOGIN" | "LOGOUT" | "TEST_SAVED" | "ANSWER_KEY_VIEWED";

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LogFilter>("ALL");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
        const res = await fetch(`/api/admin/logs?filter=${filter}`);
        const data = await res.json();
        if (data.logs) setLogs(data.logs);
    } catch(e) {
        console.error(e);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const filterOptions: LogFilter[] = ["ALL", "LOGIN", "LOGOUT", "TEST_SAVED", "ANSWER_KEY_VIEWED"];

   const getEventColor = (eventType: string) => {
    switch (eventType) {
      case "LOGIN": return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
      case "LOGOUT": return "bg-zinc-500/10 text-zinc-500 border-zinc-500/20";
      case "TEST_SAVED": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "ANSWER_KEY_VIEWED": return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      default: return "bg-zinc-500/10 text-zinc-500 border-zinc-500/20";
    }
  };

  const getEventNameTR = (event: string) => {
      switch(event) {
          case "ALL": return "HEPSİ";
          case "LOGIN": return "GİRİŞ";
          case "LOGOUT": return "ÇIKIŞ";
          case "TEST_SAVED": return "TEST KAYIT";
          case "ANSWER_KEY_VIEWED": return "CEVAP";
          default: return event;
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tighter">SİSTEM KAYITLARI</h2>
          <p className="text-zinc-500 font-mono text-sm">Canlı aktivite takibi</p>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              autoRefresh ? "bg-emerald-500/20 text-emerald-500" : "bg-zinc-800 text-zinc-500"
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${autoRefresh ? "animate-spin" : ""}`} style={{ animationDuration: "3s" }} />
            {autoRefresh ? "Canlı" : "Duraklatıldı"}
          </button>

          {/* Filter Dropdown */}
          <div className="flex items-center gap-2 bg-zinc-900 rounded-lg p-1">
            {filterOptions.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  filter === f ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {getEventNameTR(f)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl overflow-hidden backdrop-blur-sm">
        <div className="max-h-[70vh] overflow-y-auto">
          <table className="w-full">
            <thead className="bg-zinc-900/50 sticky top-0">
              <tr className="text-left text-xs font-mono text-zinc-600 uppercase tracking-widest">
                <th className="p-4">Zaman</th>
                <th className="p-4">Kullanıcı</th>
                <th className="p-4">Olay</th>
                <th className="p-4">Hedef</th>
                <th className="p-4">IP</th>
                <th className="p-4">Detay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-zinc-600 font-mono">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Kayıtlar yükleniyor...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-zinc-600 font-mono">
                    Bu filtrede kayıt bulunamadı.
                  </td>
                </tr>
              ) : (
                logs.map((log, i) => (
                  <motion.tr 
                    key={log.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="hover:bg-zinc-900/30 transition-colors"
                  >
                    <td className="p-4 font-mono text-xs text-zinc-500">
                      {new Date(log.created_at).toLocaleString('tr-TR')}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400">
                          {log.users?.username?.[0]?.toUpperCase() || "?"}
                        </div>
                        <span className="text-zinc-300 text-sm">{log.users?.username || "Bilinmeyen"}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${getEventColor(log.event_type)}`}>
                        {log.event_type === 'LOGIN' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                        {log.event_type}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-xs text-zinc-400">
                      {log.target_id || "-"}
                    </td>
                    <td className="p-4 font-mono text-xs text-zinc-600">
                      {log.ip_address || "-"}
                    </td>
                    <td className="p-4 font-mono text-xs text-zinc-600 max-w-[200px] truncate">
                      {log.details ? JSON.stringify(log.details) : "-"}
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
