"use client";

import { useState, useCallback } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export default function CodeBlock({ inline, className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : null;
  const codeString = String(children).replace(/\n$/, '');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [codeString]);

  if (inline) {
    return (
      <code className="bg-[#1e1e1e] px-1.5 py-0.5 rounded text-[13px] text-zinc-300">
        {children}
      </code>
    );
  }

  return (
    <div className="relative group/code my-3">
      {/* Language label */}
      {language && (
        <div className="absolute top-2 left-3 text-[10px] font-mono text-zinc-500 select-none z-10">
          {language}
        </div>
      )}

      {/* Copy button */}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-[#1e1e1e] border border-[#2a2a2a] text-zinc-500 hover:text-zinc-300 opacity-0 group-hover/code:opacity-100 transition-opacity z-10"
        title="Kopyala"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      <pre className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-4 pt-8 overflow-x-auto text-sm">
        <code className={className}>
          {children}
        </code>
      </pre>
    </div>
  );
}
