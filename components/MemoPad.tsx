import React, { useState, useEffect } from 'react';
import { Save, Trash2, StickyNote } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { cn } from '@/lib/utils';

export default function MemoPad() {
    const [note, setNote] = useState('');
    const [lastSaved, setLastSaved] = useState<string | null>(null);

    useEffect(() => {
        const savedNote = localStorage.getItem('user-memo');
        const savedTime = localStorage.getItem('user-memo-time');
        if (savedNote) setNote(savedNote);
        if (savedTime) setLastSaved(savedTime);
    }, []);

    const handleSave = () => {
        const now = new Date().toLocaleString('tr-TR');
        localStorage.setItem('user-memo', note);
        localStorage.setItem('user-memo-time', now);
        setLastSaved(now);
    };

    const handleClear = () => {
        if (confirm('Notları silmek istediğinize emin misiniz?')) {
            setNote('');
            setLastSaved(null);
            localStorage.removeItem('user-memo');
            localStorage.removeItem('user-memo-time');
        }
    };

    return (
        <div className="h-full flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <StickyNote className="w-5 h-5 text-[var(--color-accent)]" />
                    <h2 className="font-semibold">Not Defteri</h2>
                </div>
                <div className="text-xs text-muted-foreground">
                    {lastSaved ? `Son kayıt: ${lastSaved}` : 'Kaydedilmedi'}
                </div>
            </div>

            <div className="flex-1 p-4 relative">
                <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Buraya notlarınızı alabilirsiniz..."
                    className="w-full h-full min-h-[300px] resize-none border-0 focus-visible:ring-0 bg-transparent text-base leading-relaxed p-0 placeholder:text-muted-foreground/50"
                />
            </div>

            <div className="p-3 border-t bg-muted/30 flex justify-end gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Temizle
                </Button>
                <Button
                    size="sm"
                    onClick={handleSave}
                    className="bg-[var(--color-accent)] text-white hover:opacity-90"
                >
                    <Save className="w-4 h-4 mr-2" />
                    Kaydet
                </Button>
            </div>
        </div>
    );
}
