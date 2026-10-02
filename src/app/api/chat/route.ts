import { currentUser, json } from "@/lib/auth";
import { complete } from "@/lib/llm";
import { Expense, Message, Settlement } from "@/lib/models";
import { parseMessage } from "@/lib/parse";
import { loadLedger, money, type Ledger } from "@/lib/room";

export const maxDuration = 120;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user?.room) return json({ error: "Not in a room" }, 401);

  const body = (await req.json()) as { text?: string; imageBase64?: string };
  const text = (body.text ?? "").trim().slice(0, 1000);
  const imageBase64 = body.imageBase64?.replace(/^data:image\/\w+;base64,/, "");
  if (!text && !imageBase64) return json({ error: "Empty message" }, 400);
  if (imageBase64 && imageBase64.length > 8_000_000) return json({ error: "Image too large" }, 413);

  const roomId = user.room;
  await Message.create({ room: roomId, author: user._id, text: text || "📷 Receipt photo", hasImage: !!imageBase64 });

  const ledger = await loadLedger(roomId);
  const cur = ledger.room.currency;
  const speaker = { id: String(user._id), name: user.name };
  const p = await parseMessage(text, ledger.members, speaker, cur, imageBase64);
  const note = p.usedFallback ? "\n\n_(AI model offline, used the simple parser)_" : "";

  let reply: string;
  let expenseId = null;

  if (p.intent === "expense" && p.items.length) {
    const total = Math.round(p.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    const exp = await Expense.create({
      room: roomId,
      paidBy: p.paidBy.id,
      items: p.items,
      total,
      splitAmong: p.splitAmong.map((m) => m.id),
      source: imageBase64 ? "receipt" : p.usedFallback ? "fallback" : "chat",
      rawText: text,
    });
    expenseId = exp._id;
    const share = total / p.splitAmong.length;
    const others = p.splitAmong.filter((m) => m.id !== p.paidBy.id);
    const lines = p.items.map((i) => `• ${i.name} — ${money(i.amount, cur)}`).join("\n");
    reply =
      `Got it! ${p.paidBy.name} paid ${money(total, cur)}:\n${lines}\n\n` +
      (others.length
        ? `Split ${p.splitAmong.length === 1 ? "to one person" : `${p.splitAmong.length} ways`} → ${money(share, cur)} each. ${others.map((m) => m.name).join(", ")} ${others.length === 1 ? "owes" : "each owe"} ${p.paidBy.name} ${money(share, cur)}.`
        : `Only for ${p.paidBy.name}, so nobody owes anything for this one.`);
  } else if (p.intent === "settlement" && p.settleTo && p.settleAmount) {
    if (p.settleTo.id === speaker.id) {
      reply = "You can't pay yourself back 🙂 Who did you give the money to?";
    } else {
      await Settlement.create({ room: roomId, from: speaker.id, to: p.settleTo.id, amount: p.settleAmount });
      reply = `Recorded: ${speaker.name} paid ${p.settleTo.name} ${money(p.settleAmount, cur)}. ✅`;
    }
  } else if (p.intent === "question") {
    reply = await answerQuestion(text, speaker.name, await loadLedger(roomId)).catch(
      () => "I couldn't reach the AI model just now. Check the dashboard for the numbers.",
    );
  } else {
    reply = p.reply ?? "Tell me what you bought and the price, like “rice 1200, eggs 450”.";
  }

  await Message.create({ room: roomId, author: null, text: reply + note, expense: expenseId });
  return json({ ok: true });
}

async function answerQuestion(question: string, speaker: string, l: Ledger) {
  const name = (id: string) => l.members.find((m) => m.id === id)?.name ?? "someone";
  const cur = l.room.currency;
  const s = l.stats;
  const context = [
    `Members: ${l.members.map((m) => m.name).join(", ")}`,
    `Balances (positive = is owed money, negative = owes money): ${l.balances.map((b) => `${b.name} ${b.balance}`).join(", ")}`,
    `Suggested payments to settle up: ${l.suggestions.map((p) => `${p.from.name} pays ${p.to.name} ${p.amount}`).join("; ") || "none, all settled"}`,
    `Average daily spend (the main figure, use it when asked for "average daily spend"): ${s.avgDaily30} per day for the room over the last ${s.days30} days, ${Math.round((s.avgDaily30 / Math.max(1, l.members.length)) * 100) / 100} per person.`,
    `This month so far: ${s.monthTotal} (${s.avgDailyMonth}/day), projected month total ${s.projectedMonth}.`,
    `All-time: ${s.total} over ${s.daysTracked} days (${s.avgDaily} per day). Today: ${s.todayTotal}. Last 7 days: ${s.last7}, previous 7 days: ${s.prev7}.`,
    `Top items: ${s.topItems.map((i) => `${i.name} ${i.amount}`).join(", ")}`,
    `Recent expenses (newest first):`,
    ...l.expenses.slice(0, 40).map(
      (e) =>
        `- ${e.createdAt.toISOString().slice(0, 10)} ${name(e.paidBy)} paid ${e.total} for ${e.items.map((i) => `${i.name} ${i.amount}`).join(", ")}`,
    ),
  ].join("\n");

  return complete([
    {
      role: "system",
      content: `You are RoomPot, a friendly bookkeeper for roommates. Answer ${speaker}'s question using ONLY the data below. Currency is ${cur}. Be short (2-4 sentences), warm, and exact with numbers. If they write in Singlish, you may reply in Singlish.\n\n${context}`,
    },
    { role: "user", content: question },
  ]);
}
