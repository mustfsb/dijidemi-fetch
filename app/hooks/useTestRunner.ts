import { useState } from 'react';
import type { Test, TestData, Video, Assignment, AssignmentContext, UserAnswers, TestScoreData } from '@/types';
import type { WeeklySchedule } from '@/types/program';

export function useTestRunner(
    showToast: (msg: string, type: 'success' | 'error') => void,
    schedule: WeeklySchedule | null,
    setSchedule: (s: WeeklySchedule) => void // for auto-update
) {
    const [loading, setLoading] = useState<boolean>(false);
    const [loadingText, setLoadingText] = useState<string>('Yükleniyor...');
    const [data, setData] = useState<TestData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [videos, setVideos] = useState<Video[]>([]);
    const [videoStatus, setVideoStatus] = useState<string | null>(null);
    const [selectedTest, setSelectedTest] = useState<Test | null>(null);
    const [assignmentContext, setAssignmentContext] = useState<AssignmentContext | null>(null);
    const [userAnswers, setUserAnswers] = useState<UserAnswers>({});
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [testScore, setTestScore] = useState<TestScoreData | null>(null);
    const [loadingScore, setLoadingScore] = useState<boolean>(false);

    const loadTest = async (tId: string, context: AssignmentContext | null = null): Promise<void> => {
        setLoading(true);
        setError(null);
        setData(null);
        setVideos([]);
        setUserAnswers({});
        setVideoStatus('Hazırlanıyor...');
        setAssignmentContext(context);
        setTestScore(null);

        // Log "Test Viewed" event
        const userId = localStorage.getItem('user_uuid');
        if (userId) {
            fetch('/api/log/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    user_id: userId,
                    event_type: 'TEST_VIEWED', 
                    target_id: tId 
                })
            }).catch(console.error);
        }

        // Fetch test score
        setLoadingScore(true);
        fetch(`/api/student/test-answers?testId=${tId}`)
            .then(r => r.json())
            .then((scoreData: TestScoreData) => {
                if (scoreData.success) setTestScore(scoreData);
            })
            .catch(err => console.error(err))
            .finally(() => setLoadingScore(false));

        try {
            const res = await fetch(`/api/proxy?testId=${tId}`);
            if (!res.ok) throw new Error('Test verisi alınamadı');
            const json: TestData = await res.json();
            setData(json);

            const count = json.SoruSayisi || 40;
            for (let i = 1; i <= count; i++) {
                // We fetch videos in background
                fetch(`/api/video?testId=${tId}&soruId=${i}`)
                    .then(r => r.json())
                    .then(d => {
                        if (d.success && d.videoUrl) {
                            setVideos(p => [...p, { q: i, url: d.videoUrl }].sort((a, b) => a.q - b.q));
                        }
                    }).catch(() => { });
                // We update status periodically or just show last one?
                // The original code updated this state 40 times in a loop.
                setVideoStatus(`${i}. soru çekiliyor...`);
            }
            setVideoStatus('Tamamlandı');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Bilinmeyen hata');
            setVideoStatus('Hata');
        } finally {
            setLoading(false);
        }
    };

    const openAssignment = async (asgn: Assignment): Promise<boolean> => {
        setLoading(true);
        setLoadingText('Test yükleniyor...');
        setError(null);
        try {
            // IF KTT type, we already have the testId (it is the asgn.id)
            if (asgn.type === 'ktt') {
                const newTest = { id: asgn.id, name: asgn.title };
                setSelectedTest(newTest);
                await loadTest(asgn.id, { odevId: asgn.id });
                return true;
            }

            // Normal assignment flow
            const res = await fetch('/api/student/assignment-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ odevId: asgn.id })
            });

            const data = await res.json();
            if (!data.success || !data.testId) throw new Error(data.error || 'Test ID alınamadı');

            // Log "Assignment Opened" event
            const userId = localStorage.getItem('user_uuid');
            if (userId) {
                fetch('/api/log/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        user_id: userId,
                        event_type: 'ASSIGNMENT_OPENED', 
                        target_id: asgn.id,
                        details: { title: asgn.title }
                    })
                }).catch(console.error);
            }

            const newTest = { id: data.testId, name: asgn.title };
            setSelectedTest(newTest);
            loadTest(data.testId, { odevId: asgn.id });
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Test yüklenemedi');
            showToast('Test yüklenemedi', 'error');
            return false;
        } finally {
            setLoading(false);
            setLoadingText('Yükleniyor...');
        }
    };

    const saveAnswers = async (): Promise<void> => {
        if (!selectedTest) return;
        setIsSaving(true);
        try {
            const res = await fetch('/api/student/save-answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    testId: selectedTest.id,
                    answers: userAnswers,
                    totalQuestions: data?.SoruSayisi || 40,
                    odevId: assignmentContext?.odevId || 0,
                })
            });
            if (!res.ok) throw new Error('Hata');
            
            // Log Event
            const userId = localStorage.getItem('user_uuid');
            if (userId) {
                fetch('/api/log/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        user_id: userId,
                        event_type: 'TEST_SAVED', 
                        details: { testId: selectedTest.id, questionCount: data?.SoruSayisi } 
                    })
                }).catch(console.error);
            }

            showToast('✅ Cevaplar kaydedildi!', 'success');

            // Auto Program Update
            if (schedule) {
                let programUpdated = false;
                const updatedTasks = schedule.tasks.map(task => {
                    const testNameLower = selectedTest.name.toLowerCase();
                    const taskNameLower = task.name.toLowerCase();
                    const isNameMatch = testNameLower.includes(taskNameLower);

                    if (isNameMatch && !task.completed) {
                        programUpdated = true;
                        return { ...task, completed: true };
                    }
                    return task;
                });

                if (programUpdated) {
                    const newSchedule = { ...schedule, tasks: updatedTasks };
                    setSchedule(newSchedule);
                    localStorage.setItem('weeklySchedule', JSON.stringify(newSchedule));
                    showToast('📅 Programda ilgili ödev tamamlandı olarak işaretlendi!', 'success');
                }
            }
        } catch (e) {
            showToast('❌ Kayıt başarısız.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return {
        selectedTest, setSelectedTest,
        loading, loadingText, error,
        data,
        videos, videoStatus,
        testScore, loadingScore,
        userAnswers, setUserAnswers,
        isSaving,
        assignmentContext,
        loadTest,
        openAssignment,
        saveAnswers
    };
}
