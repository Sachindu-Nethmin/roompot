import bcrypt from "bcryptjs";
import { json, setSession } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { User } from "@/lib/models";

export async function POST(req: Request) {
  const { username, password } = (await req.json()) as { username?: string; password?: string };
  await connectDb();
  const user = await User.findOne({ username: (username ?? "").trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(password ?? "", user.passwordHash)))
    return json({ error: "Wrong username or password" }, 401);
  await setSession(String(user._id));
  return json({ ok: true });
}
