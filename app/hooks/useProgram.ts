import { useState, useEffect, useCallback } from 'react';
import type { WeeklySchedule, DailyTask } from '@/types/program';
import programData from '@/app/data/program.json';

export function useProgram(showToast: (msg: string, type: 'success' | 'error') => void) {
    const [schedule, setSchedule] = useState<WeeklySchedule | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

    useEffect(() => {
        const savedScheduleString = localStorage.getItem('weeklySchedule');
        const latestProgram = programData as any;
        let mergedSchedule = latestProgram;

        if (savedScheduleString) {
            try {
                const savedSchedule = JSON.parse(savedScheduleString);
                // If latest program has tasks, merge completion status
                if (latestProgram && latestProgram.tasks && latestProgram.tasks.length > 0) {
                    const mergedTasks = latestProgram.tasks.map((task: any) => {
                        const savedTask = savedSchedule.tasks?.find((t: any) => t.id === task.id);
                        return {
                            ...task,
                            completed: savedTask ? savedTask.completed : false
                        };
                    });
                    mergedSchedule = { ...latestProgram, tasks: mergedTasks };
                }
                // Fallback: If latest program is somehow empty but we have saved data
                else if (savedSchedule && savedSchedule.tasks && savedSchedule.tasks.length > 0) {
                    mergedSchedule = savedSchedule;
                }
            } catch (e) {
                console.error('Schedule parse error', e);
            }
        }

        if (mergedSchedule && mergedSchedule.tasks) {
            setSchedule(mergedSchedule);
            localStorage.setItem('weeklySchedule', JSON.stringify(mergedSchedule));
        }
    }, []);

    const fetchProgram = useCallback(async (forceRefresh = false) => {
        setIsAnalyzing(true);
        try {
            const method = forceRefresh ? 'POST' : 'GET';
            const res = await fetch('/api/analyze-program', { method });
            const data = await res.json();

            if (data.success && data.schedule) {
                setSchedule(prevSchedule => {
                    if (!prevSchedule) return data.schedule;
                    const newTasks = data.schedule.tasks.map((newTask: DailyTask) => {
                        const existingTask = prevSchedule.tasks.find(t => t.id === newTask.id);
                        return existingTask ? { ...newTask, completed: existingTask.completed } : newTask;
                    });
                    const finalSchedule = { ...data.schedule, tasks: newTasks };
                    localStorage.setItem('weeklySchedule', JSON.stringify(finalSchedule));
                    return finalSchedule;
                });
                if (forceRefresh) showToast('Program başarıyla yenilendi.', 'success');
            } else {
                if (forceRefresh) showToast(data.error || 'Program analiz edilemedi.', 'error');
            }
        } catch (error) {
            console.error('Program fetch error:', error);
            if (forceRefresh) showToast('Analiz sırasında bir hata oluştu.', 'error');
        } finally {
            setIsAnalyzing(false);
        }
    }, [showToast]);

    const toggleTask = (taskId: string) => {
        if (!schedule) return;
        const updatedTasks = schedule.tasks.map(t =>
            t.id === taskId ? { ...t, completed: !t.completed } : t
        );
        const updatedSchedule = { ...schedule, tasks: updatedTasks };
        setSchedule(updatedSchedule);
        localStorage.setItem('weeklySchedule', JSON.stringify(updatedSchedule));
    };

    const toggleDayTasks = (dayName: string) => {
        if (!schedule) return;
        const dayTasks = schedule.tasks.filter(t => t.day.includes(dayName));
        if (dayTasks.length === 0) return;

        const allCompleted = dayTasks.every(t => t.completed);
        const updatedTasks = schedule.tasks.map(t => {
            if (t.day.includes(dayName)) {
                return { ...t, completed: !allCompleted };
            }
            return t;
        });

        const updatedSchedule = { ...schedule, tasks: updatedTasks };
        setSchedule(updatedSchedule);
        localStorage.setItem('weeklySchedule', JSON.stringify(updatedSchedule));
    };

    const toggleSubjectTasks = (subjectName: string) => {
        if (!schedule) return;
        const subjectTasks = schedule.tasks.filter(t => t.subject === subjectName);
        if (subjectTasks.length === 0) return;

        const allCompleted = subjectTasks.every(t => t.completed);
        const updatedTasks = schedule.tasks.map(t => {
            if (t.subject === subjectName) {
                return { ...t, completed: !allCompleted };
            }
            return t;
        });

        const updatedSchedule = { ...schedule, tasks: updatedTasks };
        setSchedule(updatedSchedule);
        localStorage.setItem('weeklySchedule', JSON.stringify(updatedSchedule));
    };

    return {
        schedule,
        setSchedule, // needed for manual updates if any (like from Test auto-complete)
        isAnalyzing,
        fetchProgram,
        toggleTask,
        toggleDayTasks,
        toggleSubjectTasks
    };
}
