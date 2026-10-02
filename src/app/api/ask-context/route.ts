import { currentUser, json } from "@/lib/auth";
import { answerPrompt } from "@/lib/qa";
import { loadLedger } from "@/lib/room";

/** Room data for an on-device model to answer a question. Smaller than the server prompt to fit small context windows. */
export async function GET() {
  const user = await currentUser();
  if (!user?.room) return json({ error: "Not in a room" }, 401);
  const ledger = await loadLedger(user.room);
  return json({ system: answerPrompt({ id: String(user._id), name: user.name }, ledger, 12) });
}
