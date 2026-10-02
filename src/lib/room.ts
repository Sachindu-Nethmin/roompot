import type { Types } from "mongoose";
import { Expense, Room, Settlement, User } from "./models";
import { balances, settleUp, spendStats, type LedgerExpense } from "./ledger";

export async function loadLedger(roomId: Types.ObjectId | string) {
  const [room, users, expenseDocs, settlementDocs] = await Promise.all([
    Room.findById(roomId).lean(),
    User.find({ room: roomId }).sort({ createdAt: 1 }).lean(),
    Expense.find({ room: roomId }).sort({ createdAt: -1 }).lean(),
    Settlement.find({ room: roomId }).sort({ createdAt: -1 }).lean(),
  ]);
  if (!room) throw new Error("Room not found");

  const members = users.map((u) => ({ id: String(u._id), name: u.name }));
  const expenses: LedgerExpense[] = expenseDocs.map((e) => ({
    id: String(e._id),
    paidBy: String(e.paidBy),
    total: e.total,
    splitAmong: (e.splitAmong ?? []).map(String),
    items: (e.items ?? []).map((i) => ({ name: i.name ?? "", amount: i.amount ?? 0 })),
    createdAt: e.createdAt,
  }));
  const settlements = settlementDocs.map((s) => ({
    id: String(s._id),
    from: String(s.from),
    to: String(s.to),
    amount: s.amount,
    createdAt: s.createdAt,
  }));

  const bals = balances(members, expenses, settlements);
  return {
    room: {
      id: String(room._id),
      name: room.name,
      inviteCode: room.inviteCode,
      currency: room.currency ?? "Rs",
      timezone: room.timezone ?? "Asia/Colombo",
    },
    members,
    expenses,
    settlements,
    balances: bals,
    suggestions: settleUp(bals),
    stats: spendStats(expenses, members.length, room.timezone ?? "Asia/Colombo", new Date(), room.createdAt),
  };
}

export type Ledger = Awaited<ReturnType<typeof loadLedger>>;

export function money(n: number, currency: string) {
  return `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
