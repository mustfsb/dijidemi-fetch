// =========================================
// Diji-Fetch TypeScript Type Definitions
// =========================================

// --- Book Types ---
export interface Book {
    id: string | number;
    name: string;
}

export interface BooksBySubject {
    [subject: string]: Book[];
}

// --- Test Types ---
export interface Test {
    id: string;
    name: string;
}

export interface TestData {
    SoruSayisi: number;
    CevapAnahtari: string;
    [key: string]: unknown;
}

// --- Assignment Types ---
export interface Assignment {
    id: string;
    title: string;
    dateRange: string;
    link: string;
}

// --- Video Types ---
export interface Video {
    q: number;
    url: string;
}

export interface VideoResponse {
    success: boolean;
    videoUrl?: string;
    message?: string;
    testId?: string;
    soruId?: string;
}

// --- Auth Types ---
export interface LoginCredentials {
    username: string;
    password: string;
}

export interface LoginResponse {
    success: boolean;
    data?: unknown;
    error?: string;
}

// --- Component Props ---
export interface LoginModalProps {
    onClose: () => void;
    onLoginSuccess: (data: LoginResponse) => void;
}

// --- Toast Types ---
export interface ToastState {
    show: boolean;
    message: string;
    type: 'success' | 'error';
}

// --- User Answers ---
export interface UserAnswers {
    [questionNumber: number]: string;
}

// --- Assignment Context ---
export interface AssignmentContext {
    odevId: string;
}

// --- API Request/Response Types ---
export interface BookTestsRequest {
    id: number;
}

export interface BookTestsResponse {
    success: boolean;
    tests: Test[];
    error?: string;
}

export interface SaveAnswerRequest {
    testId: string;
    answers: UserAnswers;
    totalQuestions: number;
    dersId?: number;
    odevId?: number | string;
    turId?: number;
}

export interface AssignmentsResponse {
    assignments: Assignment[];
    error?: string;
}

// --- Cookie Types ---
export interface CookieRecord {
    [key: string]: string;
}

export interface HeaderRecord {
    [key: string]: string;
}
