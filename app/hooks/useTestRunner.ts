import { useState } from 'react';
import type { Test, TestData, Video, Assignment, AssignmentContext, UserAnswers, TestScoreData } from '@/types';
import type { WeeklySchedule } from '@/types/program';
import { authFetch } from '@/lib/tokenManager';

function sanitizeAnswerKey(value: unknown): string {
    if (typeof value !== 'string') return '';
    const cleaned = value.toUpperCase().replace(/[^A-EO]/g, '');
    return cleaned;
}

function resolveAnswerKey(payload: Record<string, unknown>): string {
    const candidateKeys = [
        'CevapAnahtari',
        'cevapAnahtari',
        'DogruCevaplar',
        'dogruCevaplar',
        'Cevaplar',
        'cevaplar',
        'tCevaplar',
        'TCevaplar'
    ];

    for (const key of candidateKeys) {
        const keyAnswer = sanitizeAnswerKey(payload[key]);
        if (keyAnswer) return keyAnswer;
    }

    for (const value of Object.values(payload)) {
        const answer = sanitizeAnswerKey(value);
        if (answer.length >= 5) return answer;
    }

    return '';
}

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
            authFetch('/api/log/create', {
                method: 'POST',
                body: JSON.stringify({
                    user_id: userId,
                    event_type: 'TEST_VIEWED',
                    target_id: tId
                })
            }).catch(console.error);
        }

        // Fetch test score
        setLoadingScore(true);
        authFetch(`/api/student/test-answers?testId=${tId}`)
            .then(r => r.json())
            .then((scoreData: TestScoreData) => {
                if (scoreData.success) setTestScore(scoreData);
            })
            .catch(err => console.error(err))
            .finally(() => setLoadingScore(false));

        try {
            const res = await authFetch(`/api/proxy?testId=${tId}`);
            if (!res.ok) throw new Error('Test verisi alınamadı');
            const json: TestData = await res.json();
            const answerKey = resolveAnswerKey(json as Record<string, unknown>);
            const normalizedData: TestData = {
                ...json,
                CevapAnahtari: answerKey || '',
                SoruSayisi: (json as any).SoruSayisi || answerKey.length || 40,
            };
            setData(normalizedData);

            if (!answerKey) {
                showToast('Bu testte cevap anahtarı bulunamadı. Sorular yüklenemedi.', 'error');
            }

            // Stream videos one-by-one as each individual request resolves.
            // Uses a concurrency limit to avoid flooding the server.
            const count = normalizedData.SoruSayisi || 40;
            setVideoStatus(`Video çözümler yükleniyor...`);

            const CONCURRENCY = 5;
            // Build a queue of question numbers to fetch
            const queue: number[] = Array.from({ length: count }, (_, i) => i + 1);
            let finished = 0;

            const fetchVideoForQuestion = async (soruId: number): Promise<void> => {
                try {
                    const r = await authFetch(`/api/video?testId=${tId}&soruId=${soruId}`);
                    const d = await r.json();
                    if (d.success && d.videoUrl) {
                        // Append immediately, keeping sort order by question number
                        setVideos(prev =>
                            [...prev, { q: soruId, url: d.videoUrl }]
                                .sort((a, b) => a.q - b.q)
                        );
                    }
                } catch {
                    // Skip silently — video not available
                } finally {
                    finished++;
                    if (finished === count) {
                        setVideoStatus('Tamamlandı');
                    } else {
                        setVideoStatus(`Video çözümler yükleniyor... (${finished}/${count})`);
                        // Pick up the next item from the queue
                        const next = queue.shift();
                        if (next !== undefined) {
                            fetchVideoForQuestion(next);
                        }
                    }
                }
            };

            // Kick off initial concurrent workers
            const initialBatch = queue.splice(0, CONCURRENCY);
            for (const soruId of initialBatch) {
                fetchVideoForQuestion(soruId);
            }

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
            const res = await authFetch('/api/student/assignment-test', {
                method: 'POST',
                body: JSON.stringify({ odevId: asgn.id })
            });

            const data = await res.json();
            if (!data.success || !data.testId) throw new Error(data.error || 'Test ID alınamadı');

            // Log "Assignment Opened" event
            const userId = localStorage.getItem('user_uuid');
            if (userId) {
                authFetch('/api/log/create', {
                    method: 'POST',
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
            await loadTest(data.testId, { odevId: asgn.id });
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
            const res = await authFetch('/api/student/save-answer', {
                method: 'POST',
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
                authFetch('/api/log/create', {
                    method: 'POST',
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
