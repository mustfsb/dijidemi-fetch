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
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  useEffect(() => {
    const initFetch = async () => {
      console.log(`[PrivateTest] Starting robust fetch for Test ID: ${testId}`);
      
      const programIds = ['14308', '14309', '14310', '0', '1'];
      const testTurs = ['1', '2'];
      
      let foundData = false;

      // Strategy 1: Try various programId/testTur combinations with GetTestById
      for (const pId of programIds) {
        if (foundData) break;
        for (const tTur of testTurs) {
          try {
            console.log(`[PrivateTest] Trying Strategy 1: programId=${pId}, testTur=${tTur}`);
            const res = await fetch(`/api/homework/fetch-test?testId=${testId}&programId=${pId}&testTur=${tTur}`);
            const json = await res.json();

            if (json.success && json.data && (json.data.Sorular || json.data.Test)) {
              console.log(`[PrivateTest] SUCCESS with Strategy 1: programId=${pId}, testTur=${tTur}`);
              const questions = json.data.Sorular || [];
              setTestData({
                success: true,
                title: json.title,
                questions: questions
              });
              foundData = true;
              break;
            }
          } catch (e) {
            console.warn(`[PrivateTest] Strategy 1 failed for pId ${pId}, tTur ${tTur}:`, e);
          }
        }
      }

      // Strategy 2: If Strategy 1 fails, try getting answers via student/test-answers API
      if (!foundData) {
        console.log(`[PrivateTest] Strategy 1 failed. Trying Strategy 2: test-answers API`);
        try {
          const res = await fetch(`/api/student/test-answers?testId=${testId}`);
          const json = await res.json();

          if (json.success && json.tCevaplar) {
            console.log(`[PrivateTest] SUCCESS with Strategy 2 (Answers Only)`);
            const answers = json.tCevaplar.split('');
            const questions = answers.map((ans: string, index: number) => ({
              SoruNo: index + 1,
              SiraNo: index + 1,
              DogruCevap: ans
            }));

            setTestData({
              success: true,
              title: `Test #${testId} (Cevap Anahtarı Modu)`,
              questions: questions
            });
            foundData = true;
          }
        } catch (e) {
          console.error(`[PrivateTest] Strategy 2 also failed:`, e);
        }
      }

      if (foundData && testData?.questions || foundData) {
          // Fetch videos (we can't easily wait for all if we want to show something fast, but let's do it for robustness)
          // We'll refetch testData questions from the local state variable just set or from the json
          // Because setTestData is async, we use the local reference.
      } else {
        setErrorStatus("Test verilerine erişilemedi. Çerezler geçersiz olabilir veya Test ID hatalı.");
      }
      
      setLoading(false);
    };

    initFetch();
  }, [testId]);

  // Separate effect for video fetching once questions are loaded
  useEffect(() => {
    if (!testData?.questions) return;

    const fetchVideos = async () => {
      console.log(`[PrivateTest] Fetching videos for ${testData.questions.length} questions...`);
      const linksMap: Record<number, string | null> = {};
      
      // Fetch in chunks to avoid overwhelming the proxy
      const questions = testData.questions;
      for (const q of questions) {
        const sNo = q.SoruNo || q.SiraNo;
        try {
          const vRes = await fetch(`/api/video?testId=${testId}&soruId=${sNo}`);
          const vJson = await vRes.json();
          linksMap[sNo] = vJson.success ? vJson.videoUrl : null;
        } catch (e) {
          linksMap[sNo] = null;
        }
        // Update incrementally
        setVideoLinks(prev => ({ ...prev, ...linksMap }));
      }
    };

    fetchVideos();
  }, [testData?.questions, testId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#050505] text-white">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500 mb-4" />
        <p className="text-zinc-400 font-medium tracking-wide">Dijidemi Sistemine Erişiliyor...</p>
        <p className="text-zinc-600 text-xs mt-2 italic px-8 text-center">Çoklu doğrulama stratejileri deneniyor (Program ID, Test Türü)...</p>
      </div>
    );
  }

  if (errorStatus && !testData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#050505] text-white p-6">
        <div className="p-8 border border-red-500/20 bg-red-500/5 rounded-3xl max-w-md text-center">
            <Video className="w-12 h-12 text-red-500 mx-auto mb-4 opacity-50" />
            <h2 className="text-xl font-bold mb-2">Erişim Hatası</h2>
            <p className="text-zinc-400 text-sm mb-6">{errorStatus}</p>
            <button 
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm transition-all"
            >
                Tekrar Dene
            </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-12 space-y-4">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider">
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" /> Doğrulandı</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent italic">
            {testData?.title || `Test #${testId}`}
          </h1>
          <div className="flex items-center space-x-4 text-zinc-500">
            <p className="text-sm">ID: <span className="text-zinc-300 font-mono">{testId}</span></p>
            <span className="w-1 h-1 rounded-full bg-zinc-700" />
            <p className="text-sm">{testData?.questions.length} Soru Bulundu</p>
          </div>
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
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
              >
                {testData?.questions.map((q) => (
                  <div key={q.SoruNo} className="group p-5 bg-zinc-900 border border-zinc-800 rounded-3xl hover:border-blue-500/30 hover:bg-zinc-800/40 transition-all duration-300">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 group-hover:text-blue-500/50 transition-colors">Soru {q.SoruNo}</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/20 group-hover:bg-emerald-500 transition-colors" />
                    </div>
                    <div className="text-3xl font-black text-white group-hover:scale-110 transition-transform origin-left">
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
                  <div key={q.SoruNo} className="group flex items-center justify-between p-4 bg-zinc-900/50 border border-zinc-800/50 rounded-2xl hover:bg-zinc-800/80 hover:border-zinc-700 transition-all duration-300">
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 flex items-center justify-center rounded-2xl bg-zinc-900 text-zinc-400 font-black text-lg border border-zinc-800 group-hover:border-blue-500/30 group-hover:text-blue-400 transition-all">
                        {q.SoruNo}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-zinc-200 group-hover:text-white transition-colors">Soru Çözümü</h4>
                        <p className="text-[11px] text-zinc-500 font-medium">Dijidemi Video Servisi</p>
                      </div>
                    </div>
                    
                    {videoLinks[q.SoruNo] ? (
                      <a 
                        href={videoLinks[q.SoruNo]!} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center space-x-2 px-5 py-2.5 bg-white text-black hover:bg-blue-500 hover:text-white rounded-xl text-xs font-bold transition-all transform active:scale-95 shadow-xl shadow-black/20"
                      >
                        <PlayCircle className="w-4 h-4" />
                        <span>VIDEOYU AÇ</span>
                      </a>
                    ) : videoLinks[q.SoruNo] === undefined ? (
                      <div className="flex items-center space-x-2 px-5 py-2.5 bg-zinc-800/50 text-zinc-500 rounded-xl text-xs font-bold animate-pulse">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>ARANIYOR</span>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2 px-5 py-2.5 bg-zinc-950 text-zinc-700 rounded-xl text-xs font-bold border border-zinc-900">
                        <Video className="w-4 h-4 opacity-20" />
                        <span>BULUNAMADI</span>
                      </div>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Info Box */}
        <div className="mt-12 p-6 bg-blue-500/5 border border-blue-500/10 rounded-3xl">
            <div className="flex gap-4">
                <div className="p-3 bg-blue-500/10 rounded-2xl h-fit">
                    <FileText className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
