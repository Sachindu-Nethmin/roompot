export default function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="card w-full max-w-sm p-6 shadow-sm">
        <div className="text-3xl mb-2">🍳</div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-ink-2 text-sm mt-1 mb-6">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}
