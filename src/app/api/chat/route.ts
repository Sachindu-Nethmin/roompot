import { currentUser, json } from "@/lib/auth";
import { fallbackParse, normalizeParsed, type Parsed } from "@/lib/extract";
import { complete } from "@/lib/llm";
import { Expense, Message, Settlement } from "@/lib/models";
import { parseMessage } from "@/lib/parse";
import { answerPrompt } from "@/lib/qa";
import { loadLedger, money } from "@/lib/room";

export const maxDuration = 120;

/** Keeps one account from using up the shared AI quota. */
const LIMIT_PER_HOUR = Number(process.env.CHAT_LIMIT_PER_HOUR ?? 60);

type Body = {
  text?: string;
  /** Server mode: receipt photo for a vision model. */
  imageBase64?: string;
  /** Browser mode: what the on-device model produced. `parsed: null` means no model was available. */
  client?: { parsed: unknown; answer?: string; receipt?: boolean };
};

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user?.room) return json({ error: "Not in a room" }, 401);

  const recent = await Message.countDocuments({ author: user._id, createdAt: { $gt: new Date(Date.now() - 3_600_000) } });
  if (recent >= LIMIT_PER_HOUR)
    return json({ error: `You've sent ${LIMIT_PER_HOUR} messages in the last hour. Please wait a bit and try again.` }, 429);

  const body = (await req.json()) as Body;
  const text = (body.text ?? "").trim().slice(0, body.client?.receipt ? 4000 : 1000);
  const imageBase64 = body.client ? undefined : body.imageBase64?.replace(/^data:image\/\w+;base64,/, "");
  if (!text && !imageBase64) return json({ error: "Empty message" }, 400);
  if (imageBase64 && imageBase64.length > 8_000_000) return json({ error: "Image too large" }, 413);
  const isReceipt = !!imageBase64 || !!body.client?.receipt;

  const roomId = user.room;
  await Message.create({
    room: roomId,
    author: user._id,
    text: isReceipt ? "📷 Receipt photo" : text,
    hasImage: isReceipt,
  });

  const ledger = await loadLedger(roomId);
  const cur = ledger.room.currency;
  const speaker = { id: String(user._id), name: user.name };

  let p: Parsed;
  if (body.client) {
    // On-device model output is untrusted input: validate it the same way as server output.
    try {
      p = body.client.parsed
        ? normalizeParsed(body.client.parsed, text, ledger.members, speaker)
        : fallbackParse(text, ledger.members, speaker, isReceipt);
    } catch {
      p = fallbackParse(text, ledger.members, speaker, isReceipt);
    }
  } else {
    p = await parseMessage(text, ledger.members, speaker, cur, imageBase64);
  }
  const note = p.usedFallback ? "\n\n_(AI model not available, used the simple parser)_" : "";

  let reply: string;
  let expenseId = null;

  if (p.intent === "expense" && p.items.length) {
    const total = Math.round(p.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    const exp = await Expense.create({
      room: roomId,
      paidBy: p.paidBy.id,
      items: p.items,
      total,
      splitAmong: p.splitAmong.map((m) => m.id),
      source: isReceipt ? "receipt" : p.usedFallback ? "fallback" : "chat",
      rawText: text,
    });
    expenseId = exp._id;
    const share = total / p.splitAmong.length;
    const others = p.splitAmong.filter((m) => m.id !== p.paidBy.id);
    const lines = p.items.map((i) => `• ${i.name} — ${money(i.amount, cur)}`).join("\n");
    reply =
      `Got it! ${p.paidBy.name} paid ${money(total, cur)}:\n${lines}\n\n` +
      (others.length
        ? `Split ${p.splitAmong.length === 1 ? "to one person" : `${p.splitAmong.length} ways`} → ${money(share, cur)} each. ${others.map((m) => m.name).join(", ")} ${others.length === 1 ? "owes" : "each owe"} ${p.paidBy.name} ${money(share, cur)}.`
        : `Only for ${p.paidBy.name}, so nobody owes anything for this one.`);
  } else if (p.intent === "settlement" && p.settleTo && p.settleAmount) {
    if (p.settleTo.id === speaker.id) {
      reply = "You can't pay yourself back 🙂 Who did you give the money to?";
    } else {
      await Settlement.create({ room: roomId, from: speaker.id, to: p.settleTo.id, amount: p.settleAmount });
      reply = `Recorded: ${speaker.name} paid ${p.settleTo.name} ${money(p.settleAmount, cur)}. ✅`;
    }
  } else if (p.intent === "question") {
    const unavailable = "I couldn't run the AI model just now. Check the Money tab for the numbers.";
    if (body.client) {
      reply = body.client.answer?.trim().slice(0, 1500) || unavailable;
    } else {
      reply = await complete([
        { role: "system", content: answerPrompt(speaker, await loadLedger(roomId)) },
        { role: "user", content: text },
      ]).catch(() => unavailable);
    }
  } else if (isReceipt) {
    reply = "I couldn't read any items on that bill. Try a sharper photo, or type the items and prices.";
  } else {
    reply = p.reply ?? "Tell me what you bought and the price, like “rice 1200, eggs 450”.";
  }

  await Message.create({ room: roomId, author: null, text: reply + note, expense: expenseId });
  return json({ ok: true });
}
