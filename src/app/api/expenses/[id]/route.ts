import { currentUser, json } from "@/lib/auth";
import { Expense, Message } from "@/lib/models";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  const user = await currentUser();
  if (!user?.room) return json({ error: "Not in a room" }, 401);
  const { id } = await ctx.params;

  const exp = await Expense.findOne({ _id: id, room: user.room });
  if (!exp) return json({ error: "Not found" }, 404);
  if (String(exp.paidBy) !== String(user._id)) return json({ error: "Only the person who paid can remove it" }, 403);

  await exp.deleteOne();
  await Message.create({
    room: user.room,
    text: `🗑️ ${user.name} removed an entry: ${exp.items.map((i) => i.name).join(", ")} (${exp.total}).`,
  });
  return json({ ok: true });
}
