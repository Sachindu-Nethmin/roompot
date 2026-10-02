export type LedgerMember = { id: string; name: string };
export type LedgerExpense = {
  id: string;
  paidBy: string;
  total: number;
  splitAmong: string[];
  items: { name: string; amount: number }[];
  createdAt: Date;
};
export type LedgerSettlement = { from: string; to: string; amount: number; createdAt: Date };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Net balance per member: positive = the room owes them, negative = they owe the room. */
export function balances(members: LedgerMember[], expenses: LedgerExpense[], settlements: LedgerSettlement[]) {
  const bal = new Map(members.map((m) => [m.id, 0]));
  const add = (id: string, v: number) => bal.has(id) && bal.set(id, bal.get(id)! + v);

  for (const e of expenses) {
    const among = e.splitAmong.length ? e.splitAmong : members.map((m) => m.id);
    add(e.paidBy, e.total);
    for (const id of among) add(id, -e.total / among.length);
  }
  for (const s of settlements) {
    add(s.from, s.amount);
    add(s.to, -s.amount);
  }
  return members.map((m) => ({ ...m, balance: round2(bal.get(m.id)!) }));
}

/** Greedy debt simplification: the fewest payments that settle everyone. */
export function settleUp(bals: ReturnType<typeof balances>) {
  const debtors = bals.filter((b) => b.balance < -0.5).map((b) => ({ ...b, left: -b.balance }));
  const creditors = bals.filter((b) => b.balance > 0.5).map((b) => ({ ...b, left: b.balance }));
  debtors.sort((a, b) => b.left - a.left);
  creditors.sort((a, b) => b.left - a.left);

  const payments: { from: LedgerMember; to: LedgerMember; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].left, creditors[j].left);
    payments.push({
      from: { id: debtors[i].id, name: debtors[i].name },
      to: { id: creditors[j].id, name: creditors[j].name },
      amount: round2(amt),
    });
    debtors[i].left -= amt;
    creditors[j].left -= amt;
    if (debtors[i].left < 0.5) i++;
    if (creditors[j].left < 0.5) j++;
  }
  return payments;
}

/** YYYY-MM-DD in the room's timezone. */
export function dayKey(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const DAY = 86_400_000;
const keyToUtc = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));

export function spendStats(
  expenses: LedgerExpense[],
  memberCount: number,
  timeZone: string,
  now = new Date(),
  roomCreated?: Date,
) {
  const today = dayKey(now, timeZone);
  const monthPrefix = today.slice(0, 7);

  const byDay = new Map<string, number>();
  for (const e of expenses) {
    const k = dayKey(e.createdAt, timeZone);
    byDay.set(k, (byDay.get(k) ?? 0) + e.total);
  }

  const firstKey = [...byDay.keys(), roomCreated ? dayKey(roomCreated, timeZone) : today].sort()[0];
  const daysTracked = Math.max(1, Math.round((keyToUtc(today) - keyToUtc(firstKey)) / DAY) + 1);
  const total = expenses.reduce((s, e) => s + e.total, 0);

  // This month: average over the days of the month that have passed (and that the room existed).
  const monthStartKey = `${monthPrefix}-01`;
  const monthFrom = firstKey > monthStartKey ? firstKey : monthStartKey;
  const monthDays = Math.max(1, Math.round((keyToUtc(today) - keyToUtc(monthFrom)) / DAY) + 1);
  const monthTotal = [...byDay.entries()].filter(([k]) => k.startsWith(monthPrefix)).reduce((s, [, v]) => s + v, 0);
  const daysInMonth = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate();
  const avgDailyMonth = monthTotal / monthDays;

  // Last 7 days vs the 7 before, for a trend arrow.
  const sumRange = (fromAgo: number, toAgo: number) => {
    let s = 0;
    for (let d = fromAgo; d <= toAgo; d++) s += byDay.get(dayKey(new Date(keyToUtc(today) - d * DAY + DAY / 2), "UTC")) ?? 0;
    return s;
  };
  const last7 = sumRange(0, 6);
  const prev7 = sumRange(7, 13);

  const series: { day: string; total: number }[] = [];
  for (let d = 29; d >= 0; d--) {
    const k = dayKey(new Date(keyToUtc(today) - d * DAY + DAY / 2), "UTC");
    series.push({ day: k, total: round2(byDay.get(k) ?? 0) });
  }

  // Rolling 30-day average (or since the room started, if newer) — the headline figure.
  const days30 = Math.min(30, daysTracked);
  const avgDaily30 = series.slice(-days30).reduce((a, p) => a + p.total, 0) / days30;

  const itemTotals = new Map<string, number>();
  for (const e of expenses)
    for (const it of e.items) {
      const n = it.name.toLowerCase();
      itemTotals.set(n, (itemTotals.get(n) ?? 0) + it.amount);
    }
  const topItems = [...itemTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, amount]) => ({ name, amount: round2(amount) }));

  return {
    total: round2(total),
    daysTracked,
    avgDaily: round2(total / daysTracked),
    avgDaily30: round2(avgDaily30),
    days30,
    avgDailyPerPerson: round2(total / daysTracked / Math.max(1, memberCount)),
    monthTotal: round2(monthTotal),
    monthDays,
    avgDailyMonth: round2(avgDailyMonth),
    projectedMonth: round2(avgDailyMonth * daysInMonth),
    todayTotal: round2(byDay.get(today) ?? 0),
    last7: round2(last7),
    prev7: round2(prev7),
    series,
    topItems,
  };
}
