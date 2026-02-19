export default function HesapPage() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <h1 className="text-red-600 text-6xl font-black mb-8 tracking-tighter uppercase">
        HESAP
      </h1>
      <div className="w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
        <p className="text-zinc-300 text-lg font-semibold">Sabit kaynak kodu kimlik bilgileri kaldırıldı.</p>
        <p className="text-zinc-500 text-sm mt-3">
          Hesap bilgileri artık uygulama kaynak kodunda tutulmuyor.
        </p>
      </div>
    </div>
  );
}
