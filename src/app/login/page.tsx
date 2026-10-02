"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthCard from "@/components/AuthCard";
import { postJson } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postJson(mode === "login" ? "/api/auth/login" : "/api/auth/register", form);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthCard title="RoomPot" subtitle="Tell the chat what you bought for the room. It splits the cost and remembers who owes whom.">
      <div className="flex gap-1 mb-5 p-1 rounded-xl bg-surface-2">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === m ? "bg-surface shadow-sm" : "text-ink-2"}`}
          >
            {m === "login" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-3">
        {mode === "register" && (
          <label className="block text-sm">
            <span className="text-ink-2">Your name (what roommates call you)</span>
            <input className="input mt-1" value={form.name} onChange={set("name")} required maxLength={40} />
          </label>
        )}
        <label className="block text-sm">
          <span className="text-ink-2">Username</span>
          <input className="input mt-1" value={form.username} onChange={set("username")} autoCapitalize="none" required />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Password</span>
          <input className="input mt-1" type="password" value={form.password} onChange={set("password")} required minLength={6} />
        </label>
        {error && <p className="text-bad text-sm">{error}</p>}
        <button className="btn w-full" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </AuthCard>
  );
}
