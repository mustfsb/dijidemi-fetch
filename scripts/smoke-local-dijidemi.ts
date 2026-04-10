import fs from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv();

type StepStatus = 'pass' | 'fail' | 'skip';

interface StepResult {
    step: string;
    status: StepStatus;
    detail: string;
}

interface LoginPayload {
    success?: boolean;
    status?: 'opening_browser' | 'awaiting_verification' | 'ready' | 'failed';
    attemptId?: string;
    message?: string;
    error?: string;
    user_id?: string;
}

const baseUrl = (process.env.LOCAL_SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const username = process.env.DIJIDEMI_USERNAME?.trim() || '';
const password = process.env.DIJIDEMI_PASSWORD?.trim() || '';
const allowWrite = process.env.LOCAL_SMOKE_ALLOW_WRITE === '1';
const cookieJar = new Map<string, string>();
const results: StepResult[] = [];

function record(step: string, status: StepStatus, detail: string): void {
    results.push({ step, status, detail });
    console.log(`[${status.toUpperCase()}] ${step}: ${detail}`);
}

function getCookieHeader(): string {
    return Array.from(cookieJar.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
}

function getSetCookies(response: Response): string[] {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof headers.getSetCookie === 'function') {
        return headers.getSetCookie();
    }

    const raw = response.headers.get('set-cookie');
    return raw ? [raw] : [];
}

function storeResponseCookies(response: Response): void {
    for (const rawCookie of getSetCookies(response)) {
        const [cookiePair] = rawCookie.split(';');
        const separatorIndex = cookiePair.indexOf('=');
        if (separatorIndex === -1) continue;

        const name = cookiePair.slice(0, separatorIndex).trim();
        const value = cookiePair.slice(separatorIndex + 1).trim();

        if (!name) continue;
        if (!value) {
            cookieJar.delete(name);
            continue;
        }

        cookieJar.set(name, value);
    }
}

async function apiFetch(urlPath: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookieHeader = getCookieHeader();
    if (cookieHeader) {
        headers.set('Cookie', cookieHeader);
    }

    const response = await fetch(`${baseUrl}${urlPath}`, {
        ...init,
        headers,
        redirect: 'follow',
    });
    storeResponseCookies(response);
    return response;
}

async function parseJson<T>(response: Response): Promise<T> {
    return response.json() as Promise<T>;
}

async function wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(): Promise<string> {
    if (!username || !password) {
        throw new Error('DIJIDEMI_USERNAME ve DIJIDEMI_PASSWORD gerekli.');
    }

    const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
    });

    const payload = await parseJson<LoginPayload>(response);

    if (response.status === 202 && payload.attemptId) {
        record('login:start', 'pass', payload.message || 'Chrome doğrulaması bekleniyor.');
        const deadline = Date.now() + (1000 * 60 * 5);

        while (Date.now() < deadline) {
            await wait(1500);
            const pollResponse = await apiFetch(`/api/auth/login/status?attemptId=${encodeURIComponent(payload.attemptId)}`);
            const pollPayload = await parseJson<LoginPayload>(pollResponse);

            if (pollResponse.ok && pollPayload.status === 'ready' && pollPayload.user_id) {
                record('login:ready', 'pass', 'Yerel Chrome oturumu hazır.');
                return pollPayload.user_id;
            }

            if (pollPayload.status === 'opening_browser' || pollPayload.status === 'awaiting_verification') {
                console.log(`[WAIT] ${pollPayload.message || 'Chrome doğrulaması bekleniyor.'}`);
                continue;
            }

            throw new Error(pollPayload.error || pollPayload.message || 'Login polling başarısız.');
        }

        throw new Error('Login polling zaman aşımına uğradı.');
    }

    if (!response.ok || !payload.user_id) {
        throw new Error(payload.error || 'Login başarısız.');
    }

    record('login', 'pass', 'Doğrudan login tamamlandı.');
    return payload.user_id;
}

async function loadFirstBookId(): Promise<string> {
    const booksPath = path.join(process.cwd(), 'app', 'data', 'books.json');
    const booksContent = await fs.readFile(booksPath, 'utf8');
    const books = JSON.parse(booksContent) as Array<{ id: string | number }>;
    const firstBookId = books[0]?.id;

    if (!firstBookId) {
        throw new Error('books.json içinde kitap bulunamadı.');
    }

    return String(firstBookId);
}

async function main(): Promise<void> {
    let selectedTestId = '';
    let selectedAssignmentId = '';
    let questionCount = 40;
    let firstVideoQuestion = 1;

    try {
        await login();
    } catch (error) {
        record('login', 'fail', error instanceof Error ? error.message : 'Bilinmeyen login hatası');
        throw error;
    }

    const statusResponse = await apiFetch('/api/status');
    const statusPayload = await parseJson<{ status?: string; error?: string }>(statusResponse);
    if (statusResponse.ok && statusPayload.status === 'valid') {
        record('status', 'pass', 'Session health valid.');
    } else {
        record('status', 'fail', statusPayload.error || statusPayload.status || `HTTP ${statusResponse.status}`);
    }

    const assignmentsResponse = await apiFetch('/api/student/assignments', { method: 'POST' });
    const assignmentsPayload = await parseJson<{ assignments?: Array<{ id: string; title: string }>; error?: string }>(assignmentsResponse);
    if (assignmentsResponse.ok && Array.isArray(assignmentsPayload.assignments)) {
        selectedAssignmentId = assignmentsPayload.assignments[0]?.id || '';
        record(
            'student.assignments',
            'pass',
            selectedAssignmentId
                ? `${assignmentsPayload.assignments.length} ödev bulundu.`
                : 'İstek başarılı, aktif ödev bulunmadı.'
        );
    } else {
        record('student.assignments', 'fail', assignmentsPayload.error || `HTTP ${assignmentsResponse.status}`);
    }

    if (selectedAssignmentId) {
        const assignmentTestResponse = await apiFetch('/api/student/assignment-test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ odevId: selectedAssignmentId }),
        });
        const assignmentTestPayload = await parseJson<{ success?: boolean; testId?: string; error?: string }>(assignmentTestResponse);
        if (assignmentTestResponse.ok && assignmentTestPayload.success && assignmentTestPayload.testId) {
            record('student.assignment-test', 'pass', `testId=${assignmentTestPayload.testId}`);
            selectedTestId = assignmentTestPayload.testId;
        } else {
            record('student.assignment-test', 'fail', assignmentTestPayload.error || `HTTP ${assignmentTestResponse.status}`);
        }
    } else {
        record('student.assignment-test', 'skip', 'Aktif ödev bulunmadı.');
    }

    const firstBookId = await loadFirstBookId();
    const bookTestsResponse = await apiFetch('/api/book-tests', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: firstBookId }),
    });
    const bookTestsPayload = await parseJson<{ success?: boolean; tests?: Array<{ id: string }>; error?: string }>(bookTestsResponse);
    if (bookTestsResponse.ok && bookTestsPayload.success && Array.isArray(bookTestsPayload.tests) && bookTestsPayload.tests.length > 0) {
        record('book-tests', 'pass', `${bookTestsPayload.tests.length} test bulundu.`);
        if (!selectedTestId) {
            selectedTestId = bookTestsPayload.tests[0].id;
        }
    } else {
        record('book-tests', 'fail', bookTestsPayload.error || `HTTP ${bookTestsResponse.status}`);
    }

    if (!selectedTestId) {
        throw new Error('Smoke için kullanılabilir testId bulunamadı.');
    }

    const proxyResponse = await apiFetch(`/api/proxy?testId=${encodeURIComponent(selectedTestId)}`);
    const proxyPayload = await parseJson<Record<string, unknown>>(proxyResponse);
    if (proxyResponse.ok) {
        questionCount = Number(proxyPayload.SoruSayisi) || 40;
        record('proxy', 'pass', `SoruSayisi=${questionCount}`);
    } else {
        record('proxy', 'fail', String(proxyPayload.error || `HTTP ${proxyResponse.status}`));
    }

    const testAnswersResponse = await apiFetch(`/api/student/test-answers?testId=${encodeURIComponent(selectedTestId)}`);
    const testAnswersPayload = await parseJson<{ success?: boolean; ogCevaplar?: string; error?: string }>(testAnswersResponse);
    if (testAnswersResponse.ok && testAnswersPayload.success) {
        record('student.test-answers', 'pass', 'Cevap durumu alındı.');
    } else {
        record('student.test-answers', 'fail', testAnswersPayload.error || `HTTP ${testAnswersResponse.status}`);
    }

    const videosResponse = await apiFetch(`/api/videos?testId=${encodeURIComponent(selectedTestId)}&count=${Math.min(questionCount, 5)}`);
    const videosPayload = await parseJson<{ success?: boolean; videos?: Array<{ q: number; url: string }>; error?: string }>(videosResponse);
    if (videosResponse.ok && videosPayload.success && Array.isArray(videosPayload.videos)) {
        if (videosPayload.videos[0]?.q) {
            firstVideoQuestion = videosPayload.videos[0].q;
        }
        record('videos', 'pass', `${videosPayload.videos.length} video bulundu.`);
    } else {
        record('videos', 'fail', videosPayload.error || `HTTP ${videosResponse.status}`);
    }

    const videoResponse = await apiFetch(`/api/video?testId=${encodeURIComponent(selectedTestId)}&soruId=${firstVideoQuestion}`);
    const videoPayload = await parseJson<{ success?: boolean; videoUrl?: string; message?: string; error?: string }>(videoResponse);
    if (videoResponse.ok) {
        record('video', 'pass', videoPayload.videoUrl || videoPayload.message || 'Video route yanıt verdi.');
    } else {
        record('video', 'fail', videoPayload.error || `HTTP ${videoResponse.status}`);
    }

    if (allowWrite) {
        if (testAnswersResponse.ok && testAnswersPayload.success && typeof testAnswersPayload.ogCevaplar === 'string') {
            const answers: Record<number, string> = {};
            for (let index = 0; index < testAnswersPayload.ogCevaplar.length; index += 1) {
                answers[index + 1] = testAnswersPayload.ogCevaplar[index];
            }

            const saveAnswerResponse = await apiFetch('/api/student/save-answer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    testId: selectedTestId,
                    answers,
                    totalQuestions: questionCount,
                    odevId: selectedAssignmentId || 0,
                }),
            });
            const saveAnswerPayload = await parseJson<{ success?: boolean; error?: string }>(saveAnswerResponse);
            if (saveAnswerResponse.ok && saveAnswerPayload.success) {
                record('student.save-answer', 'pass', 'Cevap kaydı başarılı.');
            } else {
                record('student.save-answer', 'fail', saveAnswerPayload.error || `HTTP ${saveAnswerResponse.status}`);
            }
        } else {
            record('student.save-answer', 'skip', 'Mevcut cevap verisi olmadığı için write testi atlandı.');
        }
    } else {
        record('student.save-answer', 'skip', 'Write testi LOCAL_SMOKE_ALLOW_WRITE=1 olmadığı için atlandı.');
    }

    if (process.env.GEMINI_API_KEY || process.env.GEMINI_FIRST_API_KEY) {
        const solveResponse = await apiFetch('/api/ai/solve', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                bookId: firstBookId,
                testId: selectedTestId,
                questionNumber: String(firstVideoQuestion),
            }),
        });
        const solvePayload = await parseJson<{ success?: boolean; error?: string }>(solveResponse);
        if (solveResponse.ok && solvePayload.success) {
            record('ai.solve', 'pass', 'AI çözüm üretildi.');
        } else {
            record('ai.solve', 'fail', solvePayload.error || `HTTP ${solveResponse.status}`);
        }

        const resolveImageResponse = await apiFetch('/api/playground/resolve-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                bookId: firstBookId,
                testId: selectedTestId,
                questionNumber: String(firstVideoQuestion),
            }),
        });
        const resolveImagePayload = await parseJson<{ success?: boolean; imageUrl?: string; error?: string }>(resolveImageResponse);
        if (resolveImageResponse.ok && resolveImagePayload.success) {
            record('playground.resolve-image', 'pass', resolveImagePayload.imageUrl || 'Image çözüldü.');
        } else {
            record('playground.resolve-image', 'fail', resolveImagePayload.error || `HTTP ${resolveImageResponse.status}`);
        }
    } else {
        record('ai.solve', 'skip', 'Gemini anahtarı olmadığı için atlandı.');
        record('playground.resolve-image', 'skip', 'Gemini anahtarı olmadığı için atlandı.');
    }

    const failed = results.filter((result) => result.status === 'fail');
    if (failed.length > 0) {
        throw new Error(`${failed.length} smoke adımı başarısız.`);
    }
}

main()
    .then(() => {
        console.log('\nSmoke testi tamamlandı.');
    })
    .catch((error) => {
        console.error('\nSmoke testi başarısız:', error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
