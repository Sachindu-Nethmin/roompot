import { clearSession, json } from "@/lib/auth";

export async function POST() {
  await clearSession();
  return json({ ok: true });
}
