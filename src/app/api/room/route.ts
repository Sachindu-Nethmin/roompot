import { randomBytes } from "node:crypto";
import { currentUser, json } from "@/lib/auth";
import { Message, Room, User } from "@/lib/models";

const MAX_MEMBERS = Number(process.env.MAX_ROOM_MEMBERS ?? 8);

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return json({ error: "Not logged in" }, 401);
  const body = (await req.json()) as { action: "create" | "join"; name?: string; code?: string; currency?: string };

  if (body.action === "create") {
    const name = (body.name ?? "").trim().slice(0, 40) || `${user.name}'s room`;
    const room = await Room.create({
      name,
      inviteCode: randomBytes(3).toString("hex").toUpperCase(),
      currency: (body.currency ?? "Rs").trim().slice(0, 5) || "Rs",
    });
    user.room = room._id;
    await user.save();
    await Message.create({
      room: room._id,
      text: `Welcome to ${name}! 🍳 Share the invite code **${room.inviteCode}** with your roommates.\n\nWhenever you buy something for the room, just tell me here — e.g. “rice 1200, eggs 450, gas 3800” — or send a photo of the bill. I'll split it and keep track of who owes whom.`,
    });
    return json({ ok: true });
  }

  const code = (body.code ?? "").trim().toUpperCase();
  const room = await Room.findOne({ inviteCode: code });
  if (!room) return json({ error: "No room with that code" }, 404);
  if ((await User.countDocuments({ room: room._id })) >= MAX_MEMBERS) return json({ error: "Room is full" }, 409);
  user.room = room._id;
  await user.save();
  await Message.create({ room: room._id, text: `${user.name} joined the room 👋 Costs added from now on are split with them too.` });
  return json({ ok: true });
}
