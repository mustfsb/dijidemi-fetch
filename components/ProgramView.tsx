import React from 'react';
import { WeeklySchedule, DailyTask } from '@/types/program';
import { cn } from '@/lib/utils';
import { ListChecks, CheckCircle2, Clock, Zap, BookOpen, Circle } from 'lucide-react';
import '@fontsource/inter'; // Assuming standard font
// Checking file list... lib/utils.ts is not in the list_dir output earlier? 
// Wait, I saw components/ui/button.tsx, usually that implies shadcn. 
// Let's assume standard tailwind classes for now to be safe, or check for clsx/tailwind-merge.

interface ProgramViewProps {
    schedule: WeeklySchedule | null;
    onToggleTask: (taskId: string) => void;
    onToggleDay: (day: string) => void;
    onToggleSubject: (subject: string) => void;
}

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const SHORT_DAYS = ["Pzt", "Sal", "Çrş", "Prş", "Cum", "Cmt", "Paz"];

const ProgramView: React.FC<ProgramViewProps> = ({ schedule, onToggleTask, onToggleDay, onToggleSubject }) => {
    // Group tasks by subject
    const subjectGroups: { [key: string]: DailyTask[] } = {};
    const allTasks = schedule?.tasks || [];

    allTasks.forEach(task => {
        if (!subjectGroups[task.subject]) {
            subjectGroups[task.subject] = [];
        }
        subjectGroups[task.subject].push(task);
    });

    const subjects = Object.keys(subjectGroups).sort((a, b) => a.localeCompare(b, 'tr'));

    // Calculate stats
    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(t => t.completed).length;
    const remainingTasks = totalTasks - completedTasks;
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return (
        <div className="w-full max-w-[1600px] mx-auto px-6 py-8 flex flex-col gap-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div className="flex flex-col gap-2">
                    <h2 className="text-3xl font-extrabold text-white tracking-tight">Haftalık Ödevler</h2>
                    <p className="text-zinc-500 text-sm font-medium">Tüm derslerdeki ödev ilerlemeni takip et.</p>
                </div>
                <div className="flex items-center gap-3 bg-surface-dark px-4 py-2 rounded-full border border-border-dark">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                    </span>
                    <span className="text-sm font-medium text-white">Bu Hafta</span>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                    {/* Total Tasks */}
                    <div className="bg-surface-dark border border-border-dark rounded-xl p-5 flex flex-col justify-between h-32 group hover:border-zinc-700 transition-colors">
                        <div className="flex justify-between items-start">
                             <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.1em]">Toplam Görev</span>
                            <ListChecks className="w-6 h-6 text-zinc-600" />
                        </div>
                        <div>
                            <span className="text-3xl font-bold text-white block mb-1">{totalTasks}</span>
                        </div>
                    </div>

                    {/* Completed */}
                    <div className="bg-surface-dark border border-border-dark rounded-xl p-5 flex flex-col justify-between h-32 group hover:border-zinc-700 transition-colors">
                        <div className="flex justify-between items-start">
                             <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.1em]">Tamamlanan</span>
                            <CheckCircle2 className="w-6 h-6 text-zinc-600" />
                        </div>
                        <div>
                            <span className="text-3xl font-bold text-white block mb-1">{completedTasks}</span>
                            <span className="text-xs text-zinc-500 font-medium">% tamamlandı</span>
                        </div>
                    </div>

                    {/* Remaining */}
                    <div className="bg-surface-dark border border-border-dark rounded-xl p-5 flex flex-col justify-between h-32 group hover:border-zinc-700 transition-colors">
                        <div className="flex justify-between items-start">
                             <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.1em]">Kalan</span>
                            <Clock className="w-6 h-6 text-zinc-600" />
                        </div>
                        <div>
                            <span className="text-3xl font-bold text-white block mb-1">{remainingTasks}</span>
                        </div>
                    </div>

                    {/* Focus - Logic for "Focus" could be: Subject with most incomplete tasks? Or just static for now? 
                        Let's make it show the subject with most remaining tasks.
                    */}
                    <div className="bg-surface-dark border border-border-dark rounded-xl p-5 flex flex-col justify-between h-32 group hover:border-zinc-700 transition-colors">
                        <div className="flex justify-between items-start">
                             <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.1em]">Odak</span>
                            <Zap className="w-6 h-6 text-zinc-600" />
                        </div>
                        <div>
                            <span className="text-xl font-bold text-white block mb-1 truncate">
                                {subjects.find(s => subjectGroups[s].some(t => !t.completed)) || "Hepsi Bitti!"}
                            </span>
                            <span className="text-xs text-primary font-medium">Öncelik</span>
                        </div>
                    </div>
                </div>

                {/* Vertical Progress Bar */}
                <div className="lg:col-span-1 bg-surface-dark border border-border-dark rounded-xl p-5 flex flex-col justify-center h-full min-h-[128px]">
                    <div className="flex justify-between items-end mb-3">
                        <span className="text-white font-medium text-lg">Haftalık Hedef</span>
                        <span className="text-primary font-bold text-2xl">{progressPercentage}%</span>
                    </div>
                    <div className="w-full bg-zinc-800 rounded-full h-3 mb-2 overflow-hidden">
                        <div
                            className="bg-primary h-3 rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(220,40,40,0.6)]"
                            style={{ width: `${progressPercentage}%` }}
                        ></div>
                    </div>
                    <p className="text-xs text-zinc-500 text-right">{completedTasks}/{totalTasks} Görev Tamamlandı</p>
                </div>
            </div>

            {/* Table */}
            <div className="w-full overflow-hidden rounded-xl border border-border-dark bg-background-dark shadow-2xl">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full border-collapse border-spacing-0 min-w-[1000px]">
                        <thead>
                            <tr className="bg-surface-dark border-b border-border-dark">
                                <th className="p-4 text-left min-w-[180px] sticky left-0 z-20 bg-surface-dark border-r border-border-dark">
                                    <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-wider">
                                        <BookOpen className="w-4 h-4" />
                                        Konular
                                    </div>
                                </th>
                                {SHORT_DAYS.map((day, i) => (
                                    <th key={day} className={`p-4 w-[13%] min-w-[140px] text-xs font-bold uppercase tracking-wider text-center ${i >= 5 ? 'text-primary' : 'text-zinc-500'} cursor-pointer hover:bg-zinc-800/50 transition-colors`} onClick={() => onToggleDay(DAYS[i])}>
                                        {day}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-dark">
                            {subjects.map(subject => {
                                const subjectTasks = subjectGroups[subject];
                                const subjectTotal = subjectTasks.length;
                                const subjectCompleted = subjectTasks.filter(t => t.completed).length;
                                const subjectProgress = subjectTotal > 0 ? Math.round((subjectCompleted / subjectTotal) * 100) : 0;

                                return (
                                    <tr key={subject} className="group/row hover:bg-zinc-900/30 transition-colors">
                                        {/* Subject Column */}
                                        <td className="p-4 sticky left-0 z-20 bg-background-dark group-hover/row:bg-surface-dark border-r border-border-dark transition-colors cursor-pointer hover:text-white" onClick={() => onToggleSubject(subject)}>
                                            <div className="flex flex-col gap-1.5">
                                                <span className="text-zinc-100 font-bold text-sm tracking-tight">{subject}</span>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-16 h-1 bg-zinc-800/80 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full transition-all duration-700 ${subjectProgress === 100 ? 'bg-red-500' : 'bg-red-500/40'}`}
                                                            style={{ width: `${subjectProgress}%` }}
                                                        ></div>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-zinc-500 tracking-tighter">{subjectProgress}%</span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Days Columns */}
                                        {DAYS.map(dayName => {
                                            const dayTask = subjectTasks.find(t => t.day === dayName);

                                            // Render empty cell if no task
                                            if (!dayTask) {
                                                return (
                                                    <td key={dayName} className="p-2 align-top border-r border-border-dark/30">
                                                        <div className="h-full min-h-[100px] w-full flex items-center justify-center">
                                                            {/* Optionally a small dot or nothing */}
                                                        </div>
                                                    </td>
                                                );
                                            }

                                            return (
                                                <td key={dayName} className="p-2 align-top border-r border-border-dark/30">
                                                    <div
                                                        onClick={() => onToggleTask(dayTask.id)}
                                                        className={`
                                                            h-full min-h-[100px] w-full rounded-lg p-3 flex flex-col justify-between cursor-pointer transition-all duration-300 group/cell
                                                            ${dayTask.completed
                                                                ? 'bg-primary shadow-[0_4px_12px_rgba(220,40,40,0.3)] hover:scale-[1.02] hover:bg-primary-hover'
                                                                : 'bg-zinc-900/50 border border-transparent hover:border-primary/50 hover:bg-zinc-800'
                                                            }
                                                        `}
                                                    >
                                                        <span className={`text-[11px] font-bold leading-tight tracking-tight ${dayTask.completed ? 'text-white/90 line-through' : 'text-zinc-200 group-hover/cell:text-white'}`}>
                                                            {dayTask.name} <br /> <span className="text-[9px] font-medium opacity-60 tracking-normal">{dayTask.pageRange}</span>
                                                        </span>
                                                        <div className={`flex justify-end transition-opacity ${dayTask.completed ? '' : 'opacity-0 group-hover/cell:opacity-100'}`}>
                                                            {dayTask.completed ? (
                                                                <CheckCircle2 className="w-[18px] h-[18px] text-white" />
                                                            ) : (
                                                                <Circle className="w-[18px] h-[18px] text-zinc-400" />
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Footer Legend */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 py-4 text-sm text-zinc-500">
                <div className="flex gap-6 items-center">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-zinc-900 border border-zinc-700"></div>
                        <span>Bekleyen</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-primary"></div>
                        <span>Tamamlanan</span>
                    </div>
                </div>
                <div className="text-right">
                    <p>Son eşitleme: Az önce</p>
                </div>
            </div>
        </div>
    );
};

export default ProgramView;
