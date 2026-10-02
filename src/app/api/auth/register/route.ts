import bcrypt from "bcryptjs";
import { z } from "zod";
import { json, setSession } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { User } from "@/lib/models";

const schema = z.object({
  name: z.string().trim().min(1).max(40),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{3,24}$/, "3-24 letters, numbers, _ or ."),
  password: z.string().min(6).max(100),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
  const { name, username, password } = parsed.data;

  await connectDb();
  if (await User.exists({ username })) return json({ error: "That username is taken" }, 409);
  const user = await User.create({ name, username, passwordHash: await bcrypt.hash(password, 10) });
  await setSession(String(user._id));
  return json({ ok: true });
}
