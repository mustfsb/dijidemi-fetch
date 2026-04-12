import { useState, useMemo } from 'react';
import type { Book, BooksBySubject, Test } from '@/types';
import booksData from '@/app/data/books.json';

const UPSTREAM_BASE =
    process.env.NEXT_PUBLIC_UPSTREAM_API_BASE_URL?.replace(/\/$/, '') ||
    'https://diji-fetch.duckdns.org';
const UPSTREAM_TOKEN =
    process.env.NEXT_PUBLIC_UPSTREAM_API_TOKEN || 'aBcD';

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function parseBookTestsFromHtml(html: string): Test[] {
    const regex = /<h3>(.*?)<\/h3>[\s\S]*?data-rowid="(\d+)"/g;
    return [...html.matchAll(regex)].map((match) => ({
        name: decodeHtmlEntities(match[1].trim()).replace(/\s+/g, ' '),
        id: match[2],
    }));
}

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
            const res = await fetch(`${UPSTREAM_BASE}/api/proxy`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${UPSTREAM_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: `https://www.dijidemi.com/Ogrenci/KitapTestlerTable?Id=${encodeURIComponent(book.id)}&___layout=`,
                    method: 'POST',
                    body: '',
                }),
            });

            if (!res.ok) throw new Error('Testler yüklenemedi');

            const data = await res.json();
            const html = typeof data.body === 'string' ? data.body : '';
            const tests = parseBookTestsFromHtml(html);

            if (tests.length === 0) throw new Error('Test listesi boş geldi');

            setBookTests(tests);
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
