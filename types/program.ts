export interface DailyTask {
    id: string;
    subject: string; // e.g., "Matematik"
    name: string;    // e.g., "Etap-3"
    pageRange: string; // e.g., "80-84"
    completed: boolean;
    day: string; // e.g., "Pazartesi"
}

export interface WeeklySchedule {
    id: string;
    startDate: string;
    tasks: DailyTask[];
}

export interface AnalyzeResponse {
    success: boolean;
    schedule?: WeeklySchedule;
    error?: string;
}
