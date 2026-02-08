"use client";

import { useState } from "react";

export default function HesapPage() {
  const fullData = "14308-1651:175F7";
  const [username, password] = fullData.split(":");

  const [copiedUser, setCopiedUser] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  const handleCopyUsername = () => {
    navigator.clipboard.writeText(username);
    setCopiedUser(true);
    setTimeout(() => setCopiedUser(false), 2000);
  };

  const handleCopyPassword = () => {
    navigator.clipboard.writeText(password);
    setCopiedPass(true);
    setTimeout(() => setCopiedPass(false), 2000);
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      {/* Kırmızı H1 Başlık */}
      <h1 className="text-red-600 text-6xl font-black mb-8 tracking-tighter uppercase">
        HESAP
      </h1>

      {/* Hesap Bilgisi */}
      <div className="text-zinc-500 font-mono text-lg mb-6 tracking-widest">
        {fullData}
      </div>

      {/* Buton Grubu */}
      <div className="flex w-full max-w-md h-16">
        
        {/* SOL BUTON: Kullanıcı Adı */}
        {/* Değişiklik: rounded-l-3xl (Sadece Sol Üst ve Sol Alt) */}
        <button
          onClick={handleCopyUsername}
          className={`
            flex-1 text-white font-bold text-lg transition-all duration-300
            flex items-center justify-center
            rounded-l-3xl
            border-r border-black/20 
            ${copiedUser ? "bg-green-600" : "bg-zinc-800 hover:bg-zinc-700"}
          `}
        >
          {copiedUser ? "KOPYALANDI" : "KULLANICI ADI"}
        </button>

        {/* SAĞ BUTON: Şifre */}
        {/* Değişiklik: rounded-r-3xl (Sadece Sağ Üst ve Sağ Alt) */}
        <button
          onClick={handleCopyPassword}
          className={`
            flex-1 text-white font-bold text-lg transition-all duration-300
            flex items-center justify-center
            rounded-r-3xl
            ${copiedPass ? "bg-green-600" : "bg-red-600 hover:bg-red-700"}
          `}
        >
          {copiedPass ? "KOPYALANDI" : "ŞİFRE"}
        </button>
        
      </div>
    </div>
  );
}
