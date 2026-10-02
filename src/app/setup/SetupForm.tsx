"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthCard from "@/components/AuthCard";
import { postJson } from "@/lib/client";

export default function SetupForm({ name }: { name: string }) {
  const router = useRouter();
  const [roomName, setRoomName] = useState("");
  const [currency, setCurrency] = useState("Rs");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function go(body: object) {
    setBusy(true);
    setError("");
    try {
      await postJson("/api/room", body);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthCard title={`Hi ${name} 👋`} subtitle="Join your roommates with their invite code, or start a new room.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go({ action: "join", code });
        }}
        className="space-y-2"
      >
        <span className="text-sm text-ink-2">Invite code</span>
        <div className="flex gap-2">
          <input className="input uppercase tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} placeholder="A1B2C3" required />
          <button className="btn" disabled={busy}>
            Join
          </button>
        </div>
      </form>

      <div className="flex items-center gap-3 my-6 text-xs text-ink-3">
        <div className="h-px flex-1 bg-line" /> or <div className="h-px flex-1 bg-line" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go({ action: "create", name: roomName, currency });
        }}
        className="space-y-3"
      >
        <label className="block text-sm">
          <span className="text-ink-2">Room name</span>
          <input className="input mt-1" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Boarding House 12B" />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Currency symbol</span>
          <input className="input mt-1" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={5} />
        </label>
        {error && <p className="text-bad text-sm">{error}</p>}
        <button className="btn w-full" disabled={busy}>
          Create a new room
        </button>
      </form>
    </AuthCard>
  );
}
