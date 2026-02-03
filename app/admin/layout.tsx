"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Users, FileText, Activity, LogOut, LayoutDashboard, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Middleware handles protection, we just need to know if we're on login page or not
    setIsReady(true);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/admin");
    router.refresh();
  };

  // Show loading only briefly
  if (!isReady) {
    if (pathname === "/admin") {
      return <>{children}</>;
    }
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Show login page without sidebar
  if (pathname === "/admin") {
    return <>{children}</>;
  }

  const navItems = [
    { label: "Genel Bakış", href: "/admin/dashboard", icon: LayoutDashboard },
    { label: "Kullanıcılar", href: "/admin/users", icon: Users },
    { label: "AI Kayıtları", href: "/admin/logs/ai", icon: Sparkles },
    { label: "Aktivite", href: "/admin/logs", icon: Activity },
    { label: "Ödevler", href: "/admin/homework", icon: FileText },
  ];

  return (
    <div className="flex h-screen bg-black text-zinc-100 overflow-hidden font-sans selection:bg-red-900 selection:text-white">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-900 bg-zinc-950/50 flex flex-col backdrop-blur-xl">
        <div className="p-6 border-b border-zinc-900">
          <h1 className="text-xl font-bold tracking-tighter flex items-center gap-2">
            diji-fetch <span className="bg-red-600 px-2 py-0.5 rounded text-sm ml-1">admin</span>
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group ${
                  isActive
                    ? "text-white bg-zinc-900"
                    : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-zinc-900 rounded-xl"
                    initial={false}
                    transition={{
                      type: "spring",
                      stiffness: 500,
                      damping: 30,
                    }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-3">
                  <Icon className="w-5 h-5" />
                  <span className="font-medium tracking-wide">{item.label}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-zinc-900">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full text-zinc-500 hover:text-red-500 hover:bg-red-950/20 rounded-xl transition-all duration-300"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Çıkış</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-black relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-black to-black opacity-40 pointer-events-none" />
        <div className="relative z-10 p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
