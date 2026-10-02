/**
 * Prompt, output schema and post-processing for turning a chat message into an expense.
 * Shared by the server (Ollama / hosted model) and the browser (on-device WebLLM), so both
 * paths produce exactly the same records.
 */
import { z } from "zod";

export type Member = { id: string; name: string };

export type Parsed = {
  intent: "expense" | "settlement" | "question" | "other";
  items: { name: string; amount: number }[];
  paidBy: Member;
  splitAmong: Member[];
  settleTo: Member | null;
  settleAmount: number | null;
  reply: string | null;
  usedFallback: boolean;
};

const parsedSchema = z.object({
  intent: z.enum(["expense", "settlement", "question", "other"]).catch("other"),
  items: z
    .array(z.object({ name: z.string().min(1), amount: z.coerce.number() }))
    .catch([])
    .default([]),
  paidBy: z.string().nullish(),
  splitWith: z.array(z.string()).catch([]).default([]),
  settleTo: z.string().nullish(),
  settleAmount: z.coerce.number().nullish(),
  reply: z.string().nullish(),
});

/** JSON Schema used to constrain small on-device models to valid output. */
export const OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["expense", "settlement", "question", "other"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, amount: { type: "number" } },
        required: ["name", "amount"],
      },
    },
    paidBy: { anyOf: [{ type: "string" }, { type: "null" }] },
    splitWith: { type: "array", items: { type: "string" } },
    settleTo: { anyOf: [{ type: "string" }, { type: "null" }] },
    settleAmount: { anyOf: [{ type: "number" }, { type: "null" }] },
    reply: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["intent", "items", "paidBy", "splitWith", "settleTo", "settleAmount", "reply"],
};

export const RECEIPT_NOTE =
  "[This is a shop receipt or bill. Treat it as an expense and list every purchased item with its price. Ignore totals, tax lines, change and cash given.]";

export function systemPrompt(members: Member[], speaker: Member, currency: string) {
  return `You are RoomPot, the friendly bookkeeper for roommates who share cooking costs.
Room members: ${members.map((m) => m.name).join(", ")}.
The person talking to you right now is ${speaker.name}. Currency: ${currency}.

Classify the message and extract data. Reply with ONLY a JSON object:
{
  "intent": "expense" | "settlement" | "question" | "other",
  "items": [{"name": "rice", "amount": 1200}],
  "paidBy": null,
  "splitWith": [],
  "settleTo": null,
  "settleAmount": null,
  "reply": null
}

Rules:
- "expense": someone bought things for the room. One entry in "items" per thing, with its price.
- Prices: "1.2k" = 1200, "2k" = 2000, "Rs.450" = 450, "450/=" = 450. Amounts are plain numbers.
- If one price covers several things ("rice and dhal 1500"), make ONE item "rice and dhal".
- Keep sizes and counts that are written ("rice 5kg", "eggs x10"). Never add ones that are not.
- "paidBy": a member name only if the message says someone else paid ("Kasun bought bread 200"). Otherwise null (the speaker paid).
- "splitWith": member names only if the message limits who shares the cost ("shampoo for me and Nimal 800"). Include the speaker if they say "me". Empty list means everyone shares.
- "settlement": the speaker paid back money to a member ("gave Kasun 1500", "paid Nimal 500"). Set settleTo and settleAmount.
- "question": asking about spending, balances, who owes what, averages, history.
- "other": greetings or anything else. Put a short friendly reply in "reply". If they mention buying something but give no price, ask for the price in "reply".
- Never invent prices.`;
}

/** Pulls the first JSON object out of a model reply (tolerates ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON in model reply");
  return JSON.parse(text.slice(start, end + 1));
}

export function matchMember(name: string | null | undefined, members: Member[], speaker: Member): Member | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (["me", "i", "myself", "mama", "mata"].includes(n)) return speaker;
  return (
    members.find((m) => m.name.toLowerCase() === n) ??
    members.find((m) => m.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]) ??
    members.find((m) => m.name.toLowerCase().startsWith(n) || n.startsWith(m.name.toLowerCase())) ??
    null
  );
}

export const validAmount = (a: number) => Number.isFinite(a) && a > 0 && a < 10_000_000;

/** Validates raw model output and resolves names to room members. Throws if the output is unusable. */
export function normalizeParsed(raw: unknown, text: string, members: Member[], speaker: Member): Parsed {
  const p = parsedSchema.parse(raw);
  const splitAmong = p.splitWith.map((n) => matchMember(n, members, speaker)).filter((m): m is Member => !!m);
  // Models sometimes drop the speaker from "for me and Nimal"; the words are unambiguous, so add them back.
  if (splitAmong.length && /\b(me|us|we|myself|mata|mama|apita|api)\b/i.test(text)) splitAmong.push(speaker);
  return {
    intent: p.intent,
    items: p.items
      .map((i) => ({ name: i.name.trim(), amount: Math.round(i.amount * 100) / 100 }))
      .filter((i) => i.name && validAmount(i.amount)),
    paidBy: matchMember(p.paidBy, members, speaker) ?? speaker,
    splitAmong: splitAmong.length ? [...new Map(splitAmong.map((m) => [m.id, m])).values()] : members,
    settleTo: matchMember(p.settleTo, members, speaker),
    settleAmount: p.settleAmount && validAmount(p.settleAmount) ? p.settleAmount : null,
    reply: p.reply ?? null,
    usedFallback: false,
  };
}

/** Rule-based backup so the room keeps working when no model is available. */
export function fallbackParse(text: string, members: Member[], speaker: Member, receipt = false): Parsed {
  const base: Parsed = {
    intent: "other",
    items: [],
    paidBy: speaker,
    splitAmong: members,
    settleTo: null,
    settleAmount: null,
    reply: null,
    usedFallback: true,
  };
  const toNum = (s: string) => {
    const k = /k$/i.test(s);
    const n = parseFloat(s.replace(/[k,]/gi, ""));
    return k ? n * 1000 : n;
  };

  if (receipt) {
    const items = receiptLines(text);
    return items.length
      ? { ...base, intent: "expense", items }
      : { ...base, reply: "I couldn't read any items on that bill. Try a sharper photo, or type the items and prices." };
  }

  const settle = text.match(/(?:paid|gave|sent|returned)\s+(\w+)\s+(?:rs\.?\s*)?([\d.,]+k?)/i);
  if (settle) {
    const to = matchMember(settle[1], members, speaker);
    const amt = toNum(settle[2]);
    if (to && validAmount(amt)) return { ...base, intent: "settlement", settleTo: to, settleAmount: amt };
  }

  if (/\?\s*$|^(how|what|who|when|show)\b/i.test(text.trim())) return { ...base, intent: "question" };

  const items: Parsed["items"] = [];
  const re = /([a-z඀-෿][a-z඀-෿\s&]*?)\s*[-:=]?\s*(?:rs\.?|lkr)?\s*(\d[\d,]*(?:\.\d+)?k?)(?:\/=)?/gi;
  for (const m of text.matchAll(re)) {
    const name = m[1].replace(/\b(bought|buy|got|for|and|paid)\b/gi, " ").replace(/\s+/g, " ").trim();
    const amount = toNum(m[2]);
    if (name && validAmount(amount)) items.push({ name, amount });
  }
  if (items.length) return { ...base, intent: "expense", items };
  return { ...base, reply: "Tell me what you bought and the price, like “rice 1200, eggs 450”." };
}

const SKIP_LINE = /total|cash|change|balance|tax|vat|discount|card|tel|date|time|invoice|bill no|qty|thank/i;

/** One item per receipt line: the text, then the price at the end of the line. */
function receiptLines(text: string) {
  const items: Parsed["items"] = [];
  for (const line of text.split("\n")) {
    if (SKIP_LINE.test(line)) continue;
    const m = line.match(/^(.*?[a-z].*?)\s+(?:rs\.?\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*$/i);
    if (!m) continue;
    const amount = parseFloat(m[2].replace(/,/g, ""));
    const name = m[1].replace(/[^\p{L}\p{N}\s()./&-]/gu, "").trim();
    if (name && validAmount(amount)) items.push({ name, amount });
  }
  return items;
}
