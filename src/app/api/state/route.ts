import { currentUser, json } from "@/lib/auth";
import { modelName } from "@/lib/llm";
import { Message } from "@/lib/models";
import { loadLedger } from "@/lib/room";

export async function GET() {
  const user = await currentUser();
  if (!user?.room) return json({ error: "Not in a room" }, 401);

  const [ledger, msgs] = await Promise.all([
    loadLedger(user.room),
    Message.find({ room: user.room }).sort({ createdAt: -1 }).limit(150).lean(),
  ]);

  return json({
    me: { id: String(user._id), name: user.name },
    model: modelName,
    ...ledger,
    expenses: ledger.expenses.slice(0, 50),
    settlements: ledger.settlements.slice(0, 30),
    messages: msgs.reverse().map((m) => ({
      id: String(m._id),
      author: m.author ? String(m.author) : null,
      text: m.text,
      hasImage: m.hasImage,
      createdAt: m.createdAt,
    })),
  });
}
