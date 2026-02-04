// app/private-test/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  PlayCircle, 
  CheckCircle2, 
  Video, 
  FileText, 
  Loader2,
  AlertCircle,
  Database,
  X
} from 'lucide-react';
import VideoPlayer from '@/components/VideoPlayer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface QuestionData {
  id: number;
  answer: string;
  videoUrl?: string | null;
}

export default function PrivateTestPage() {
  const testId = "1062219";
  
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testTitle, setTestTitle] = useState<string>(`Test #${testId}`);
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [videoStatus, setVideoStatus] = useState<string>('Hazırlanıyor...');
  const [activeTab, setActiveTab] = useState<'answers' | 'videos'>('answers');
  
  // Pop-up State
  const [selectedVideo, setSelectedVideo] = useState<{url: string, id: number} | null>(null);

  useEffect(() => {
    setMounted(true);
    const initFetch = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/proxy?testId=${testId}`);
        if (!res.ok) throw new Error('Test verileri çekilemedi.');
        
        const data = await res.json();
        const cevapAnahtari = data.CevapAnahtari || "";
        const soruSayisi = data.SoruSayisi || cevapAnahtari.length || 0;
        setTestTitle(data.Adi || data.TestAdi || `Test #${testId}`);

        if (soruSayisi === 0) throw new Error("Veri bulunamadı.");

        const initialQuestions: QuestionData[] = cevapAnahtari.split('').map((ans: string, index: number) => ({
          id: index + 1,
          answer: ans,
          videoUrl: null
        }));
        
        setQuestions(initialQuestions);
        setLoading(false);

        // Arka planda videoları çek (Anasayfa logic)
        for (let i = 1; i <= soruSayisi; i++) {
          fetch(`/api/video?testId=${testId}&soruId=${i}`)
            .then(r => r.json())
            .then(vData => {
              if (vData.success && vData.videoUrl) {
                setQuestions(prev => prev.map(q => 
                  q.id === i ? { ...q, videoUrl: vData.videoUrl } : q
                ));
              }
            }).catch(() => {});
        }
        setVideoStatus('Tamamlandı');

      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    };

    initFetch();
  }, [testId]);

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#020202] text-white">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600 mb-6" />
        <p className="text-zinc-500 font-mono text-[10px] tracking-[0.3em] uppercase">Initializing Engine</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020202] text-zinc-100 p-6 md:p-16 selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto">
        
        {/* Superior Header */}
        <header className="mb-16 space-y-6">
          <div className="flex items-center space-x-3">
             <div className="w-10 h-[1px] bg-blue-600" />
             <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500">Private DIJI-fetcher</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-black tracking-normal text-white leading-none italic uppercase">
            GARDAŞ ALLAH ZİHİN AÇIKLIĞI VERSİN BOKUNU ÇIKARMADAN İZLE
          </h1>
          <div className="flex items-center space-x-4 opacity-40 font-mono text-[10px]">
             <span>SYSTEM_READY</span>
             <span>ID: {testId}</span>
             <span>COUNT: {questions.length}</span>
          </div>
        </header>

        {/* Avant-Garde Navigation */}
        <nav className="flex space-x-12 border-b border-zinc-900/50 mb-12 relative">
          {[
            { id: 'answers', label: 'Cevap Anahtarı', icon: FileText },
            { id: 'videos', label: 'Video Çözümler', icon: Video }
          ].map((tab) => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-6 text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center space-x-3 group relative ${activeTab === tab.id ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
            >
              <tab.icon className={`w-4 h-4 transition-transform ${activeTab === tab.id ? 'scale-110 text-blue-500' : 'group-hover:scale-110'}`} />
              <span>{tab.label}</span>
              {activeTab === tab.id && <motion.div layoutId="tabBar" className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 z-10" />}
            </button>
          ))}
        </nav>

        {/* Dynamic Display */}
        <main className="min-h-[400px]">
          <AnimatePresence mode="wait">
            {activeTab === 'answers' ? (
              <motion.div 
                key="ans_grid" 
                initial={{ opacity: 0, scale: 0.95 }} 
                animate={{ opacity: 1, scale: 1 }} 
                className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4"
              >
                {questions.map((q) => (
                  <div key={q.id} className="group relative aspect-square bg-[#0a0a0a] border border-zinc-900/50 rounded-2xl flex flex-col items-center justify-center hover:border-blue-500/50 hover:bg-zinc-900/50 transition-all duration-300">
                    <span className="absolute top-3 left-4 text-[12px] font-bold font-mono text-zinc-600 group-hover:text-blue-500/50 transition-colors">{q.id}</span>
                    <div className="text-4xl font-black text-white">{q.answer}</div>
                    {q.videoUrl && <div className="absolute bottom-3 right-3 w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />}
                  </div>
                ))}
              </motion.div>
            ) : (
              <motion.div 
                key="vid_list" 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {questions.map((q) => (
                  <div key={q.id} className="flex items-center justify-between p-6 bg-[#0a0a0a] border border-zinc-900/50 rounded-3xl hover:bg-zinc-900/30 group transition-all">
                    <div className="flex items-center space-x-6">
                      <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-zinc-900 text-sm font-black text-zinc-600 border border-zinc-800 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-xl">
                        {q.id}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white tracking-tight uppercase">Soru Analizi</h4>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Cevap: {q.answer}</p>
                      </div>
                    </div>
                    
                    {q.videoUrl ? (
                      <button 
                        onClick={() => setSelectedVideo({ url: q.videoUrl!, id: q.id })}
                        className="flex items-center space-x-3 px-6 py-3 bg-white text-black hover:bg-blue-600 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-tighter transition-all"
                      >
                        <PlayCircle className="w-4 h-4" />
                        <span>Oynat</span>
                      </button>
                    ) : (
                      <div className="px-6 py-3 bg-zinc-950 border border-zinc-900 text-zinc-800 rounded-2xl text-[10px] font-black uppercase tracking-tighter">
                        Hazırlanıyor
                      </div>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Video Pop-up (Dialog) */}
        <Dialog open={!!selectedVideo} onOpenChange={() => setSelectedVideo(null)}>
          <DialogContent className="max-w-4xl bg-black border-zinc-800 p-0 overflow-hidden rounded-3xl">
            <DialogHeader className="p-6 border-b border-zinc-900 flex flex-row items-center justify-between">
              <DialogTitle className="text-xl font-black italic tracking-tighter text-white">
                Soru {selectedVideo?.id} Çözümü
              </DialogTitle>
            </DialogHeader>
            <div className="aspect-video bg-black">
              {selectedVideo && (
                <VideoPlayer 
                  src={selectedVideo.url} 
                  videoId={`private-${testId}-q${selectedVideo.id}`} 
                  autoPlay={true} 
                />
              )}
            </div>
            <div className="p-4 bg-zinc-950/50 flex justify-center">
               <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Dijidemi Cinematic Video Player</p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
