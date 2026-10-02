"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SpendChart from "./SpendChart";
import { useOnDeviceAI, type AIStatus } from "./useOnDeviceAI";
import { postJson } from "@/lib/client";

type Member = { id: string; name: string };
type State = {
  me: Member;
  aiMode: "browser" | "server";
  model: string;
  room: { id: string; name: string; inviteCode: string; currency: string };
  members: Member[];
  balances: (Member & { balance: number })[];
  suggestions: { from: Member; to: Member; amount: number }[];
  expenses: {
    id: string;
    paidBy: string;
    total: number;
    splitAmong: string[];
    items: { name: string; amount: number }[];
    createdAt: string;
  }[];
  messages: { id: string; author: string | null; text: string; hasImage: boolean; createdAt: string }[];
  stats: {
    total: number;
    daysTracked: number;
    avgDaily: number;
    avgDaily30: number;
    days30: number;
    avgDailyPerPerson: number;
    monthTotal: number;
    monthDays: number;
    avgDailyMonth: number;
    projectedMonth: number;
    todayTotal: number;
    last7: number;
    prev7: number;
    series: { day: string; total: number }[];
    topItems: { name: string; amount: number }[];
  };
};

const EXAMPLES = ["rice 1200, eggs 450, gas 3800", "haal 2k, pol 3k 360", "gave Kasun 1500", "what's our average daily spend?"];

export default function Dashboard() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<"chat" | "money">("chat");
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState("reading…");
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const ai = useOnDeviceAI(state?.aiMode === "browser");

  const load = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.status === 401) return router.replace("/login");
    if (res.ok) setState(await res.json());
  }, [router]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(() => document.visibilityState === "visible" && load(), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    const n = state?.messages.length ?? 0;
    if (n !== lastCount.current || sending) listRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
    lastCount.current = n;
  }, [state?.messages.length, sending, tab]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if ((!text.trim() && !image) || sending) return;
    setSending(true);
    setStage("reading…");
    setError("");
    const msg = text.trim();
    const img = image;
    setText("");
    setImage(null);
    try {
      if (state?.aiMode === "browser") await sendOnDevice(msg, img);
      else await postJson("/api/chat", { text: msg, imageBase64: img ?? undefined });
    } catch (err) {
      setError((err as Error).message);
    }
    await load();
    setSending(false);
  }

  /** Browser mode: read the bill and run Gemma on this device, then send only the result. */
  async function sendOnDevice(msg: string, img: string | null) {
    if (!state) return;
    const local = await import("@/lib/browser-ai");
    let body = msg;
    const receipt = !!img;
    if (img) {
      setStage("reading the bill on your device…");
      const ocr = await local.readReceipt(`data:image/jpeg;base64,${img}`);
      body = [msg, ocr].filter(Boolean).join("\n");
    }
    const engine = ai.status.phase === "ready" ? ai.engine.current : null;
    if (!engine) return postJson("/api/chat", { text: body, client: { parsed: null, receipt } });

    setStage("Gemma is thinking on your device…");
    let parsed: unknown = null;
    try {
      parsed = await local.extractOnDevice(engine, body, state.members, state.me, state.room.currency, receipt);
    } catch (err) {
      console.error("on-device extraction failed", err);
    }
    let answer: string | undefined;
    if ((parsed as { intent?: string } | null)?.intent === "question") {
      const { system } = await fetch("/api/ask-context").then((r) => r.json());
      answer = await local.answerOnDevice(engine, system, body).catch(() => undefined);
    }
    await postJson("/api/chat", { text: body, client: { parsed, answer, receipt } });
  }

  async function markPaid(from: string, to: string, amount: number) {
    await postJson("/api/settle", { from, to, amount }).catch((err) => setError(err.message));
    load();
  }

  async function removeExpense(id: string) {
    if (!confirm("Remove this entry?")) return;
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    load();
  }

  async function logout() {
    await postJson("/api/auth/logout", {});
    router.replace("/login");
  }

  if (!state) return <div className="flex-1 flex items-center justify-center text-ink-3">Loading…</div>;

  const cur = state.room.currency;
  const money = (n: number) => `${cur} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const nameOf = (id: string | null) => state.members.find((m) => m.id === id)?.name ?? "Former member";
  const myBal = state.balances.find((b) => b.id === state.me.id)?.balance ?? 0;
  const s = state.stats;
  const trend = s.prev7 > 0 ? ((s.last7 - s.prev7) / s.prev7) * 100 : null;

  const chat = (
    <section className="card flex flex-col min-h-0 h-[calc(100dvh-8.5rem)] lg:h-[calc(100dvh-6.5rem)]">
      <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {state.messages.map((m) => {
          const mine = m.author === state.me.id;
          const bot = m.author === null;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              {!mine && <span className="text-[11px] text-ink-3 mb-0.5 px-1">{bot ? "🍳 RoomPot" : nameOf(m.author)}</span>}
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words ${
                  mine ? "text-white rounded-br-md" : "rounded-bl-md"
                }`}
                style={{ background: mine ? "var(--bubble-me)" : bot ? "var(--bubble-bot)" : "var(--surface-2)" }}
              >
                <Rich text={m.text} />
              </div>
              <span className="text-[10px] text-ink-3 mt-0.5 px-1">
                {new Date(m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            </div>
          );
        })}
        {sending && (
          <div className="flex flex-col items-start">
            <span className="text-[11px] text-ink-3 mb-0.5 px-1">🍳 RoomPot</span>
            <div className="rounded-2xl rounded-bl-md px-3.5 py-2 text-ink-2 animate-pulse" style={{ background: "var(--bubble-bot)" }}>
              {stage}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line p-3 space-y-2">
        {state.messages.length < 6 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setText(ex)} className="btn-ghost text-xs whitespace-nowrap">
                {ex}
              </button>
            ))}
          </div>
        )}
        {image && (
          <div className="flex items-center gap-2 text-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/jpeg;base64,${image}`} alt="Receipt to send" className="h-12 rounded-md border border-line" />
            <button className="btn-ghost text-xs" onClick={() => setImage(null)}>
              Remove
            </button>
          </div>
        )}
        {state.aiMode === "browser" && <AIBar status={ai.status} onStart={ai.start} />}
        {error && <p className="text-bad text-sm">{error}</p>}
        <form onSubmit={send} className="flex gap-2 items-center">
          <label className="btn-ghost cursor-pointer text-lg leading-none py-2" title="Send a photo of the bill">
            📷
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setImage(await shrinkImage(f));
              }}
            />
          </label>
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What did you buy? e.g. bread 180, dhal 650"
            disabled={sending}
          />
          <button className="btn" disabled={sending || (!text.trim() && !image)}>
            Send
          </button>
        </form>
      </div>
    </section>
  );

  const moneyPanel = (
    <div className="space-y-4 lg:overflow-y-auto lg:h-[calc(100dvh-6.5rem)] lg:pr-1">
      <section className="card p-5">
        <div className="text-sm text-ink-2">Average daily spend · last {s.days30 === 30 ? "30 days" : `${s.days30} ${s.days30 === 1 ? "day" : "days"}`}</div>
        <div className="text-5xl font-bold tracking-tight mt-1">{money(Math.round(s.avgDaily30))}</div>
        <div className="text-sm text-ink-2 mt-2">
          {money(Math.round(s.avgDaily30 / Math.max(1, state.members.length)))} per person per day ·{" "}
          {state.members.length} {state.members.length === 1 ? "member" : "members"}
        </div>
        <div className="text-xs text-ink-3 mt-1">
          This month: {money(Math.round(s.avgDailyMonth))}/day · all-time: {money(Math.round(s.avgDaily))}/day over {s.daysTracked} {s.daysTracked === 1 ? "day" : "days"}
        </div>

        <div className="grid grid-cols-3 gap-2 mt-5">
          <Tile label="Today" value={money(s.todayTotal)} />
          <Tile label="This month" value={money(s.monthTotal)} sub={s.monthDays >= 3 ? `→ ${money(Math.round(s.projectedMonth))} projected` : "projection after 3 days"} />
          <Tile
            label="Last 7 days"
            value={money(s.last7)}
            sub={trend === null ? "—" : `${trend >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(trend))}% vs prev week`}
          />
        </div>

        <div className="mt-5">
          <div className="text-xs text-ink-3 mb-1">Daily spend, last 30 days</div>
          <SpendChart series={s.series} avg={s.avgDaily30} currency={cur} />
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Settle up</h2>
          <span className={`text-sm font-semibold ${myBal > 0.5 ? "text-good" : myBal < -0.5 ? "text-bad" : "text-ink-2"}`}>
            {myBal > 0.5 ? `You get back ${money(myBal)}` : myBal < -0.5 ? `You owe ${money(-myBal)}` : "You're all square"}
          </span>
        </div>
        {state.suggestions.length === 0 ? (
          <p className="text-sm text-ink-2 mt-3">Everyone is settled. 🎉</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {state.suggestions.map((p) => {
              const involved = p.from.id === state.me.id || p.to.id === state.me.id;
              return (
                <li key={p.from.id + p.to.id} className="flex items-center justify-between py-2.5 gap-2">
                  <span className="text-sm">
                    <b>{p.from.id === state.me.id ? "You" : p.from.name}</b> → <b>{p.to.id === state.me.id ? "you" : p.to.name}</b>
                    <span className="ml-2 font-semibold tabular-nums">{money(p.amount)}</span>
                  </span>
                  {involved && (
                    <button className="btn-ghost text-xs" onClick={() => markPaid(p.from.id, p.to.id, p.amount)}>
                      Mark paid
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {state.balances.map((b) => (
            <div key={b.id} className="rounded-xl bg-surface-2 px-3 py-2">
              <div className="text-xs text-ink-2 truncate">{b.id === state.me.id ? `${b.name} (you)` : b.name}</div>
              <div className={`text-sm font-semibold tabular-nums ${b.balance > 0.5 ? "text-good" : b.balance < -0.5 ? "text-bad" : ""}`}>
                {b.balance > 0.5 ? "+" : b.balance < -0.5 ? "−" : ""}
                {money(Math.abs(b.balance))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {s.topItems.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold mb-3">Where the money goes</h2>
          <ul className="space-y-2">
            {s.topItems.map((it) => (
              <li key={it.name} className="text-sm">
                <div className="flex justify-between">
                  <span className="capitalize">{it.name}</span>
                  <span className="tabular-nums text-ink-2">{money(it.amount)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2 mt-1">
                  <div className="h-1.5 rounded-full" style={{ width: `${(it.amount / s.topItems[0].amount) * 100}%`, background: "var(--bar)" }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5">
        <h2 className="font-semibold mb-2">Recent purchases</h2>
        {state.expenses.length === 0 && <p className="text-sm text-ink-2">Nothing yet. Tell the chat what you bought.</p>}
        <ul className="divide-y divide-line">
          {state.expenses.map((e) => (
            <li key={e.id} className="py-2.5 flex justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate">{e.items.map((i) => i.name).join(", ")}</div>
                <div className="text-xs text-ink-3">
                  {e.paidBy === state.me.id ? "You" : nameOf(e.paidBy)} ·{" "}
                  {new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {e.splitAmong.length > 0 && e.splitAmong.length !== state.members.length
                    ? ` · split with ${e.splitAmong.map((id) => (id === state.me.id ? "you" : nameOf(id))).join(", ")}`
                    : ""}
                </div>
              </div>
              <div className="flex items-start gap-2 shrink-0">
                <span className="font-semibold tabular-nums">{money(e.total)}</span>
                {e.paidBy === state.me.id && (
                  <button onClick={() => removeExpense(e.id)} className="text-ink-3 hover:text-bad text-xs" title="Remove">
                    ✕
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  return (
    <div className="flex-1 w-full max-w-6xl mx-auto px-4 py-3 flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-lg truncate">🍳 {state.room.name}</h1>
          <div className="text-xs text-ink-3 truncate">
            Invite code <span className="font-mono font-semibold text-ink-2 tracking-wider">{state.room.inviteCode}</span> · AI:{" "}
            <span className="font-mono">{state.aiMode === "browser" ? "Gemma 2B on your device" : state.model}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-ink-2 hidden sm:inline">{state.me.name}</span>
          <button className="btn-ghost text-sm" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <div className="flex gap-1 p-1 rounded-xl bg-surface-2 lg:hidden">
        {(["chat", "money"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${tab === t ? "bg-surface shadow-sm" : "text-ink-2"}`}
          >
            {t === "chat" ? "Chat" : `Money · ${money(Math.round(s.avgDaily30))}/day`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-4 min-h-0">
        <div className={`min-w-0 ${tab === "chat" ? "" : "hidden lg:block"}`}>{chat}</div>
        <div className={`min-w-0 ${tab === "money" ? "" : "hidden lg:block"}`}>{moneyPanel}</div>
      </div>
    </div>
  );
}

function AIBar({ status, onStart }: { status: AIStatus; onStart: (modelId: string) => void }) {
  if (status.phase === "off" || status.phase === "checking") return null;
  if (status.phase === "ready")
    return (
      <div className="text-xs text-ink-3 flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-good" /> Gemma is running on this device. Your messages and photos stay here.
      </div>
    );
  if (status.phase === "unsupported")
    return (
      <p className="text-xs text-ink-3">
        On-device AI isn&apos;t available here ({status.reason}). Simple “item price” messages still work. For the full AI, open RoomPot in
        a recent Chrome or Edge, or Safari on iOS 26+.
      </p>
    );
  if (status.phase === "loading")
    return (
      <div className="text-xs text-ink-2">
        <div className="flex justify-between mb-1">
          <span>Loading Gemma onto your device…</span>
          <span className="tabular-nums">{Math.round(status.progress * 100)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-2">
          <div className="h-1.5 rounded-full transition-all" style={{ width: `${status.progress * 100}%`, background: "var(--bar)" }} />
        </div>
        <div className="text-ink-3 truncate mt-1">{status.text}</div>
      </div>
    );
  return (
    <div className="rounded-xl bg-surface-2 p-3 text-sm flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium">{status.phase === "error" ? "Couldn't load the AI model" : "Turn on the AI"}</div>
        <div className="text-xs text-ink-2">
          {status.phase === "error"
            ? status.message
            : "Gemma runs on your phone, so your messages never leave it. One-time download of about 1.4 GB. Use Wi-Fi."}
        </div>
      </div>
      <button className="btn text-sm shrink-0" onClick={() => onStart(status.modelId)}>
        {status.phase === "error" ? "Retry" : "Turn on"}
      </button>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2 min-w-0">
      <div className="text-[11px] text-ink-2">{label}</div>
      <div className="text-sm font-semibold truncate">{value}</div>
      {sub && <div className="text-[10px] text-ink-3 truncate">{sub}</div>}
    </div>
  );
}

/** Renders **bold** and _italic_ without injecting HTML. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : part.startsWith("_") && part.endsWith("_") && part.length > 2 ? (
          <em key={i} className="opacity-70">
            {part.slice(1, -1)}
          </em>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Downscale receipt photos in the browser so they upload fast and fit the model's context. */
async function shrinkImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
}
