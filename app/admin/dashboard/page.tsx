"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/db/supabase";
import { Users, Activity, FileText, TrendingUp } from "lucide-react";

interface Stats {
  totalUsers: number;
  todayLogins: number;
  activeHomeworks: number;
  totalLogs: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, todayLogins: 0, activeHomeworks: 0, totalLogs: 0 });
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    
    try {
      const res = await fetch('/api/admin/stats');
      const data = await res.json();
      
      if (data.stats) {
        setStats(data.stats);
        setRecentLogs(data.recentLogs);
      }
    } catch (e) {
      console.error(e);
    }

    setLoading(false);
  };

  const statCards = [
    { label: "Toplam Kullanıcı", value: stats.totalUsers, icon: Users, color: "text-blue-500" },
    { label: "Bugünkü Girişler", value: stats.todayLogins, icon: TrendingUp, color: "text-emerald-500" },
    { label: "Aktif Ödevler", value: stats.activeHomeworks, icon: FileText, color: "text-purple-500" },
    { label: "Toplam Kayıt", value: stats.totalLogs, icon: Activity, color: "text-orange-500" },
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl font-black tracking-tighter text-white"
        >
          DASHBOARD
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-zinc-500 font-mono"
        >
          Sistem Özeti & Canlı İstatistikler
        </motion.p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="p-6 rounded-3xl bg-zinc-950 border border-zinc-900 relative overflow-hidden group hover:border-zinc-800 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-xl bg-zinc-900 ${stat.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              <h3 className="text-zinc-500 font-mono text-xs tracking-wider uppercase mb-1">{stat.label}</h3>
              <div className="text-3xl font-bold text-white tracking-tight">
                {loading ? "..." : stat.value.toLocaleString()}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Recent Activity */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="bg-zinc-950 border border-zinc-900 rounded-3xl overflow-hidden"
      >
        <div className="p-6 border-b border-zinc-900">
          <h3 className="font-bold text-zinc-300 flex items-center gap-2">
            <Activity className="w-5 h-5 text-red-500" />
            SON AKTİVİTELER
          </h3>
        </div>
        <div className="divide-y divide-zinc-900/50">
          {loading ? (
            <div className="p-8 text-center text-zinc-600 font-mono">Yükleniyor...</div>
          ) : recentLogs.length === 0 ? (
            <div className="p-8 text-center text-zinc-600 font-mono">Henüz aktivite yok</div>
          ) : (
            recentLogs.map((log) => (
              <div key={log.id} className="p-4 flex items-center justify-between hover:bg-zinc-900/30 transition-colors">
                <div className="flex items-center gap-4">
                  <span className={`
                    px-2 py-1 rounded text-xs font-bold border
                    ${log.event_type === 'LOGIN' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 
                      log.event_type === 'TEST_SAVED' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                      'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'}
                  `}>
                    {log.event_type}
                  </span>
                  <span className="text-zinc-300">{log.users?.username || "Unknown"}</span>
                </div>
                <span className="text-xs font-mono text-zinc-600">
                  {new Date(log.created_at).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
