import { currentUser, json } from "@/lib/auth";
import { Message, Settlement, User } from "@/lib/models";
import { money } from "@/lib/room";
import { Room } from "@/lib/models";

/** Record that `from` paid `to`. Either side of the payment can record it. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user?.room) return json({ error: "Not in a room" }, 401);
  const { from, to, amount } = (await req.json()) as { from: string; to: string; amount: number };
  const me = String(user._id);
  if (from !== me && to !== me) return json({ error: "You can only record payments you made or received" }, 403);
  if (!(amount > 0) || from === to) return json({ error: "Invalid payment" }, 400);

  const [a, b, room] = await Promise.all([User.findById(from), User.findById(to), Room.findById(user.room)]);
  if (!a || !b || String(a.room) !== String(user.room) || String(b.room) !== String(user.room))
    return json({ error: "Both people must be in your room" }, 400);

  await Settlement.create({ room: user.room, from, to, amount });
  await Message.create({
    room: user.room,
    text: `✅ ${a.name} paid ${b.name} ${money(amount, room?.currency ?? "Rs")} (marked by ${user.name}).`,
  });
  return json({ ok: true });
}
