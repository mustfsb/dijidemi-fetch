import { useRef, useState } from 'react';
import type { Test, TestData, Video, Assignment, AssignmentContext, UserAnswers, TestScoreData } from '@/types';
import type { WeeklySchedule } from '@/types/program';
import { authFetch } from '@/lib/tokenManager';

// Direct upstream URL — set NEXT_PUBLIC_UPSTREAM_API_BASE_URL in Vercel env vars
const UPSTREAM_BASE =
    process.env.NEXT_PUBLIC_UPSTREAM_API_BASE_URL?.replace(/\/$/, '') ||
    'https://diji-fetch.duckdns.org';
const UPSTREAM_TOKEN =
    process.env.NEXT_PUBLIC_UPSTREAM_API_TOKEN || 'aBcD';

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
    const activeLoadIdRef = useRef<number>(0);

    const loadTest = async (tId: string, context: AssignmentContext | null = null): Promise<void> => {
        const loadId = activeLoadIdRef.current + 1;
        activeLoadIdRef.current = loadId;
        const isStaleLoad = (): boolean => activeLoadIdRef.current !== loadId;

        setLoading(true);
        setError(null);
        setData(null);
        setVideos([]);
        setUserAnswers({});
        setVideoStatus(null);
        setAssignmentContext(context);
        setTestScore(null);

        try {
            // Single direct request: GET http://194.62.55.93:8000/api/test?testId=<id>
            const res = await fetch(
                `${UPSTREAM_BASE}/api/test?testId=${encodeURIComponent(tId)}`,
                { headers: { Authorization: `Bearer ${UPSTREAM_TOKEN}` } }
            );
            if (!res.ok) throw new Error(`Upstream ${res.status}`);
            const json: TestData = await res.json();
            if (isStaleLoad()) return;

            const answerKey = resolveAnswerKey(json as Record<string, unknown>);
            setData({
                ...json,
                CevapAnahtari: answerKey || '',
                SoruSayisi: (json as any).SoruSayisi || answerKey.length || 40,
            });

            if (!answerKey) {
                showToast('Bu testte cevap anahtarı bulunamadı.', 'error');
            }
        } catch (e) {
            if (!isStaleLoad()) {
                setError(e instanceof Error ? e.message : 'Bilinmeyen hata');
            }
        } finally {
            if (!isStaleLoad()) {
                setLoading(false);
            }
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
