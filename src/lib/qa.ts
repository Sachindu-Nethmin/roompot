import type { Ledger } from "./room";

/** Instructions + room data for answering a question. Used by the server model and sent to on-device models. */
export function answerPrompt(speaker: { id: string; name: string }, l: Ledger, recentExpenses = 40) {
  const name = (id: string) => l.members.find((m) => m.id === id)?.name ?? "someone";
  const s = l.stats;
  const mine = l.balances.find((b) => b.id === speaker.id)?.balance ?? 0;
  const context = [
    `Members: ${l.members.map((m) => m.name).join(", ")}`,
    `${speaker.name}'s own balance: ${mine > 0.5 ? `is owed ${mine}` : mine < -0.5 ? `owes ${-mine}` : "all square"}.`,
    `Balances (positive = is owed money, negative = owes money): ${l.balances.map((b) => `${b.name} ${b.balance}`).join(", ")}`,
    `Suggested payments to settle up: ${l.suggestions.map((p) => `${p.from.name} pays ${p.to.name} ${p.amount}`).join("; ") || "none, all settled"}`,
    `Average daily spend (the main figure, use it when asked for "average daily spend"): ${s.avgDaily30} per day for the room over the last ${s.days30} days, ${Math.round((s.avgDaily30 / Math.max(1, l.members.length)) * 100) / 100} per person.`,
    `This month so far: ${s.monthTotal} (${s.avgDailyMonth}/day), projected month total ${s.projectedMonth}.`,
    `All-time: ${s.total} over ${s.daysTracked} days (${s.avgDaily} per day). Today: ${s.todayTotal}. Last 7 days: ${s.last7}, previous 7 days: ${s.prev7}.`,
    `Top items: ${s.topItems.map((i) => `${i.name} ${i.amount}`).join(", ")}`,
    `Recent expenses (newest first):`,
    ...l.expenses
      .slice(0, recentExpenses)
      .map(
        (e) =>
          `- ${e.createdAt.toISOString().slice(0, 10)} ${name(e.paidBy)} paid ${e.total} for ${e.items.map((i) => `${i.name} ${i.amount}`).join(", ")}`,
      ),
  ].join("\n");

  return `You are RoomPot, a friendly bookkeeper for roommates. Answer ${speaker.name}'s question using ONLY the data below. Currency is ${l.room.currency}. Be short (2-4 sentences), warm, and exact with numbers.\n\n${context}`;
}
