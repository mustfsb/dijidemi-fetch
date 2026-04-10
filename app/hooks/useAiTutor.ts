import { useState } from 'react';
import type { Test } from '@/types';
import { authFetch } from '@/lib/tokenManager';

export function useAiTutor() {
    const [activeAiQuestion, setActiveAiQuestion] = useState<string | null>(null);
    const [aiInitialMessage, setAiInitialMessage] = useState<string>('');
    const [aiContext, setAiContext] = useState<any>(null);
    const [isAiLoadingFor, setIsAiLoadingFor] = useState<string | null>(null);

    const handleAskAI = async (questionNumber: string, selectedTest: Test | null, selectedBookId: string | undefined) => {
        if (!selectedTest) return;
        if (activeAiQuestion === questionNumber) return;

        setActiveAiQuestion(questionNumber);
        setAiInitialMessage('');
        setAiContext({
            bookId: selectedBookId || '55782',
            testId: selectedTest.id,
            questionNumber: questionNumber
        });
        setIsAiLoadingFor(questionNumber);

        try {
            const response = await authFetch('/api/ai/solve', {
                method: 'POST',
                body: JSON.stringify({
                    bookId: selectedBookId || '55782',
                    testId: selectedTest.id,
                    questionNumber: questionNumber,
                })
            });
            const data = await response.json();
            if (data.success) {
                setAiContext((prev: any) => ({ ...prev, imageUrl: data.imageUrl }));
                setAiInitialMessage(data.solution);
            } else {
                setAiInitialMessage('❌ Hata: ' + (data.error || 'Çözüm alınamadı.'));
            }
        } catch (error) {
            setAiInitialMessage('❌ Bağlantı hatası oluştu.');
        } finally {
            setIsAiLoadingFor(null);
        }
    };

    return {
        activeAiQuestion,
        setActiveAiQuestion,
        aiInitialMessage,
        setAiInitialMessage,
        aiContext,
        isAiLoadingFor,
        handleAskAI
    };
}
