import { useState, useMemo } from 'react';
import type { Book, BooksBySubject, Test } from '@/types';
import booksData from '@/app/data/books.json';
import { authFetch } from '@/lib/tokenManager';

const groupBooksBySubject = (books: Book[]): BooksBySubject => {
    const subjectGroups: BooksBySubject = {};
    const subjectRegex = /(TÜRKÇE|MATEMATİK|KİMYA|FİZİK|GEOMETRİ|BİYOLOJİ)/i;
    books.forEach(book => {
        const match = book.name.match(subjectRegex);
        let subject = 'Diğer';
        if (match) {
            subject = match[1].toUpperCase();
            if (['MATEMATİK', 'GEOMETRİ'].includes(subject)) {
                if (book.name.includes('AYT MATEMATİK')) subject = 'AYT MATEMATİK';
                else if (book.name.includes('TYT MATEMATİK')) subject = 'TYT MATEMATİK';
                else if (book.name.includes('YKS GEOMETRİ')) subject = 'GEOMETRİ';
            }
            if (subject === 'TÜRKÇE' && book.name.includes('TYT TÜRKÇE')) subject = 'TYT TÜRKÇE';
            if (['KİMYA', 'FİZİK', 'BİYOLOJİ'].includes(subject)) subject = `YKS ${subject}`;
        }
        if (!subjectGroups[subject]) subjectGroups[subject] = [];
        subjectGroups[subject].push(book);
    });
    return subjectGroups;
};

export function useBooks() {
    const [books] = useState<Book[]>(booksData as Book[]);
    const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
    const [selectedBook, setSelectedBook] = useState<Book | null>(null);
    const [bookTests, setBookTests] = useState<Test[]>([]);
    const [loadingTests, setLoadingTests] = useState<boolean>(false);
    const [bookError, setBookError] = useState<string | null>(null);

    const groupedBooks = useMemo(() => groupBooksBySubject(books), [books]);
    const subjects = useMemo(() => Object.keys(groupedBooks).sort(), [groupedBooks]);
    const currentBooks = selectedSubject ? groupedBooks[selectedSubject] : [];

    const handleBookClick = async (book: Book): Promise<void> => {
        setSelectedBook(book);
        setLoadingTests(true);
        setBookError(null);
        setBookTests([]);
        try {
            const res = await authFetch('/api/book-tests', {
                method: 'POST',
                body: JSON.stringify({ id: book.id })
            });
            const d = await res.json().catch(() => ({}));

            if (!res.ok || !d.success) {
                throw new Error(typeof d.error === 'string' ? d.error : 'Testler yüklenemedi');
            }

            setBookTests(Array.isArray(d.tests) ? d.tests : []);
        } catch (e) {
            setBookError(e instanceof Error ? e.message : 'Testler yüklenemedi');
        } finally {
            setLoadingTests(false);
        }
    };

    return {
        books,
        groupedBooks,
        subjects,
        currentBooks,
        selectedSubject,
        setSelectedSubject,
        selectedBook,
        setSelectedBook,
        bookTests,
        loadingTests,
        handleBookClick,
        bookError,
    };
}
