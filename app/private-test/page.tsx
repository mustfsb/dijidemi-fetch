// app/private-test/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  PlayCircle, 
  CheckCircle2, 
  ChevronRight, 
  Video, 
  FileText, 
  Loader2,
  ExternalLink
} from 'lucide-react';

// --- Types ---
interface Question {
  SoruNo: number;
  SiraNo: number;
  DogruCevap: string;
  BeslemeMetni?: string;
}

interface TestData {
  success: boolean;
  title: string;
  questions: Question[];
}

interface VideoResult {
  soruNo: number;
  videoUrl: string | null;
}

export default function PrivateTestPage() {
  const testId = "1062219";
  const [loading, setLoading] = useState(true);
  const [testData, setTestData] = useState<TestData | null>(null);
  const [videoLinks, setVideoLinks] = useState<Record<number, string | null>>({});
  const [activeTab, setActiveTab] = useState<'answers' | 'videos'>('answers');

  useEffect(() => {
    const initFetch = async () => {
      try {
        // 1. Fetch Test Details (Answers)
        const testRes = await fetch(`/api/homework/fetch-test?testId=${testId}`);
        const testJson = await testRes.json();
        
        if (testJson.success) {
          const questions = testJson.data.Sorular || [];
          setTestData({
            success: true,
            title: testJson.title,
            questions: questions
          });

          // 2. Fetch Video Links for each question
          // Note: In a real app, this would be optimized, but here we process them for the ID 1062219
          const videoPromises = questions.map(async (q: Question) => {
            const sNo = q.SoruNo || q.SiraNo;
            const vRes = await fetch(`/api/video?testId=${testId}&soruId=${sNo}`);
            const vJson = await vRes.json();
            return { soruNo: sNo, videoUrl: vJson.success ? vJson.videoUrl : null };
          });

          const results = await Promise.all(videoPromises);
          const linksMap: Record<number, string | null> = {};
          results.forEach(r => {
            linksMap[r.soruNo] = r.videoUrl;
          });
          setVideoLinks(linksMap);
        }
      } catch (err) {
        console.error("Fetch error:", err);
      } finally {
        setLoading(false);
      }
    };

    initFetch();
  }, [testId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#050505] text-white">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500 mb-4" />
        <p className="text-zinc-400 font-medium tracking-wide">Test Verileri Hazırlanıyor...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-12 space-y-4">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider">
            <span>Özel Test Erişimi</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent italic">
            {testData?.title || `Test #${testId}`}
          </h1>
          <p className="text-zinc-500 text-lg">Test ID: {testId} • Toplam {testData?.questions.length} Soru</p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-6 border-b border-zinc-800 mb-8">
          <button 
            onClick={() => setActiveTab('answers')}
            className={`pb-4 text-sm font-medium transition-all relative ${activeTab === 'answers' ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Cevap Anahtarı
            {activeTab === 'answers' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
          </button>
          <button 
            onClick={() => setActiveTab('videos')}
            className={`pb-4 text-sm font-medium transition-all relative ${activeTab === 'videos' ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Video Çözümler
            {activeTab === 'videos' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
          </button>
        </div>

        {/* Content Section */}
        <div className="grid grid-cols-1 gap-4">
          <AnimatePresence mode="wait">
            {activeTab === 'answers' ? (
              <motion.div 
                key="answers"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4"
              >
                {testData?.questions.map((q) => (
                  <div key={q.SoruNo} className="group p-4 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-zinc-700 transition-all">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-mono text-zinc-500">Soru {q.SoruNo}</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="mt-2 text-2xl font-bold text-white group-hover:text-blue-400 transition-colors">
                      {q.DogruCevap}
                    </div>
                  </div>
                ))}
              </motion.div>
            ) : (
              <motion.div 
                key="videos"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-3"
              >
                {testData?.questions.map((q) => (
                  <div key={q.SoruNo} className="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-2xl hover:bg-zinc-800/50 transition-all group">
                    <div className="flex items-center space-x-4">
                      <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-400 font-mono text-sm border border-zinc-700 group-hover:bg-blue-500/10 group-hover:text-blue-400 group-hover:border-blue-500/20 transition-all">
                        {q.SoruNo}
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-zinc-200">Soru Çözümü</h4>
                        <p className="text-xs text-zinc-500">Dijidemi Eğitim Platformu</p>
                      </div>
                    </div>
                    
                    {videoLinks[q.SoruNo] ? (
                      <a 
                        href={videoLinks[q.SoruNo]!} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center space-x-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-blue-500/10"
                      >
                        <PlayCircle className="w-4 h-4" />
                        <span>İzle</span>
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-600 italic">Video Bulunamadı</span>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Credit */}
        <div className="mt-16 pt-8 border-t border-zinc-900 flex justify-between items-center opacity-40">
          <p className="text-xs font-mono">ID: {testId}</p>
          <div className="flex space-x-4">
            <Video className="w-4 h-4 outline-none" />
            <FileText className="w-4 h-4 outline-none" />
          </div>
        </div>
      </div>
    </div>
  );
}
