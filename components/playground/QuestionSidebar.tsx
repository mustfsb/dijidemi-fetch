"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronDown, Book, FileText, Loader2 } from "lucide-react";
import booksData from "@/app/data/books.json";

interface SelectedQuestion {
  id: string;
  title: string;
  imageUrl?: string;
  bookId?: string;
}

interface SidebarProps {
  selectedQuestions: SelectedQuestion[];
  onToggleQuestion: (id: string, title: string, imageUrl?: string, bookId?: string) => void;
}

function parseBooks() {
  const subjects: { [key: string]: { id: string; name: string }[] } = {};

  booksData.forEach((book) => {
    let subject = "Diğer";
    if (book.name.includes("TÜRKÇE")) subject = "Türkçe";
    else if (book.name.includes("MATEMATİK") && book.name.includes("TYT")) subject = "TYT Matematik";
    else if (book.name.includes("MATEMATİK") && book.name.includes("AYT")) subject = "AYT Matematik";
    else if (book.name.includes("GEOMETRİ")) subject = "Geometri";
    else if (book.name.includes("KİMYA")) subject = "Kimya";
    else if (book.name.includes("FİZİK")) subject = "Fizik";
    else if (book.name.includes("BİYOLOJİ")) subject = "Biyoloji";

    if (!subjects[subject]) subjects[subject] = [];
    subjects[subject].push({ id: book.id, name: book.name });
  });

  return subjects;
}

export default function QuestionSidebar({ selectedQuestions, onToggleQuestion }: SidebarProps) {
  const subjects = useMemo(() => parseBooks(), []);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] overflow-hidden">
      <div className="p-4 border-b border-[#2a2a2a]">
        <h2 className="text-sm font-bold text-zinc-400 tracking-wider uppercase flex items-center gap-2">
          <Book className="w-4 h-4" />
          Kitaplar
        </h2>
        {selectedQuestions.length > 0 && (
          <p className="text-xs text-red-500 mt-1">
            {selectedQuestions.length} seçili
          </p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto playground-scroll p-2">
        {Object.entries(subjects).map(([subject, books]) => (
          <SubjectNode
            key={subject}
            subject={subject}
            books={books}
            selectedQuestions={selectedQuestions}
            onToggleQuestion={onToggleQuestion}
          />
        ))}
      </div>
    </div>
  );
}

function SubjectNode({ subject, books, selectedQuestions, onToggleQuestion }: {
  subject: string;
  books: { id: string; name: string }[];
  selectedQuestions: SelectedQuestion[];
  onToggleQuestion: (id: string, title: string, imageUrl?: string, bookId?: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="select-none">
      <motion.div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors hover:bg-[#1e1e1e] text-zinc-400"
      >
        <span className="text-zinc-600">
          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <Book className="w-4 h-4 text-red-500/70" />
        <span className="text-sm font-medium truncate">{subject}</span>
        <span className="text-[10px] text-zinc-700 ml-auto">{books.length}</span>
      </motion.div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden ml-4"
          >
            {books.map((book) => (
              <BookNode
                key={book.id}
                book={book}
                subject={subject}
                selectedQuestions={selectedQuestions}
                onToggleQuestion={onToggleQuestion}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BookNode({ book, subject, selectedQuestions, onToggleQuestion }: {
  book: { id: string; name: string };
  subject: string;
  selectedQuestions: SelectedQuestion[];
  onToggleQuestion: (id: string, title: string, imageUrl?: string, bookId?: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [tests, setTests] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTests = async () => {
    if (tests.length > 0 || loading) return;

    setLoading(true);
    try {
      const res = await fetch("/api/book-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: parseInt(book.id) })
      });
      const data = await res.json();
      if (data.success && data.tests) {
        setTests(data.tests);
      }
    } catch (error) {
      console.error("Failed to fetch tests:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = () => {
    if (!isOpen) fetchTests();
    setIsOpen(!isOpen);
  };

  return (
    <div className="select-none">
      <motion.div
        onClick={handleClick}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-[#1e1e1e] text-zinc-500"
      >
        <span className="text-zinc-700">
          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <FileText className="w-3 h-3" />
        <span className="text-xs font-medium truncate">{book.name.replace(/-2026/g, "").trim()}</span>
      </motion.div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden ml-4"
          >
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-zinc-600 text-xs">
                <Loader2 className="w-3 h-3 animate-spin" />
                Yükleniyor...
              </div>
            ) : tests.length === 0 ? (
              <div className="px-2 py-2 text-zinc-700 text-xs">Test bulunamadı</div>
            ) : (
              tests.map((test) => (
                <TestNode
                  key={test.id}
                  test={test}
                  bookId={book.id}
                  bookName={book.name}
                  subject={subject}
                  selectedQuestions={selectedQuestions}
                  onToggleQuestion={onToggleQuestion}
                />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TestNode({ test, bookId, bookName, subject, selectedQuestions, onToggleQuestion }: {
  test: { id: string; name: string };
  bookId: string;
  bookName: string;
  subject: string;
  selectedQuestions: SelectedQuestion[];
  onToggleQuestion: (id: string, title: string, imageUrl?: string, bookId?: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [questions, setQuestions] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchQuestionCount = async () => {
    if (questions.length > 0 || loading) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/student/test-answers?testId=${test.id}&turID=2`);
      const data = await res.json();

      let count = 0;
      if (data.success) {
          if (data.ogCevaplar) count = data.ogCevaplar.length;
          else if (data.tCevaplar) count = data.tCevaplar.length;
          else if (data.bos) count = data.bos;
      }
      if (count > 0) {
        setQuestions(Array.from({ length: count }, (_, i) => i + 1));
      } else {
        setQuestions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      }
    } catch (error) {
      console.error("Failed to fetch test data:", error);
      setQuestions([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = () => {
    if (!isOpen) fetchQuestionCount();
    setIsOpen(!isOpen);
  };

  return (
    <div className="select-none">
      <motion.div
        onClick={handleClick}
        className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-[#1e1e1e] text-zinc-600"
      >
        <span className="text-zinc-700">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <span className="text-sm truncate font-medium">{test.name}</span>
      </motion.div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden ml-3 flex flex-wrap gap-2 py-2"
          >
            {loading ? (
              <div className="flex items-center gap-1 text-zinc-600 text-sm px-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Yükleniyor...
              </div>
            ) : questions.length === 0 ? (
              <div className="text-zinc-700 text-xs px-2">Soru yok</div>
            ) : (
              questions.map((qNum) => {
                const questionId = `${test.id}-q${qNum}`;
                const questionTitle = `${subject} - ${test.name} - Soru ${qNum}`;
                const isSelected = selectedQuestions.some(q => q.id === questionId);

                return (
                  <motion.button
                    key={qNum}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!isSelected) {
                        try {
                          const res = await fetch("/api/playground/resolve-image", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              bookId,
                              testId: test.id,
                              questionNumber: qNum
                            })
                          });
                          const data = await res.json();
                          onToggleQuestion(questionId, questionTitle, data.imageUrl, bookId);
                        } catch (e) {
                          onToggleQuestion(questionId, questionTitle, undefined, bookId);
                        }
                      } else {
                        onToggleQuestion(questionId, questionTitle, undefined, bookId);
                      }
                    }}
                    className={`
                      w-10 h-10 rounded-lg text-sm font-mono font-bold transition-all flex items-center justify-center relative overflow-hidden
                      ${isSelected
                        ? "bg-red-600 text-white shadow-lg shadow-red-900/40"
                        : "bg-[#141414] text-zinc-500 hover:bg-[#1e1e1e] hover:text-zinc-300 border border-[#2a2a2a]"}
                    `}
                  >
                    {qNum}
                  </motion.button>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
