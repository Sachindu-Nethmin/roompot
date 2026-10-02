import { z } from "zod";
import { complete, extractJson } from "./llm";

export type Member = { id: string; name: string };

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

function systemPrompt(members: Member[], speaker: Member, currency: string) {
  return `You are RoomPot, the friendly bookkeeper for roommates who share cooking costs.
Room members: ${members.map((m) => m.name).join(", ")}.
The person talking to you right now is ${speaker.name}.
Currency: ${currency}. Messages can be English, Sinhala, or Singlish (Sinhala typed in English letters, e.g. "haal kilo 2 1200 gaththa", "bath ekata 300").

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
- "expense": someone bought things for the room. One entry in "items" per thing with its price. Use short English item names (haal -> rice, biththara -> eggs, pol -> coconut, elavalu -> vegetables, gas -> gas cylinder).
- Prices: "Rs.450" = 450, "450/=" = 450. In English, "1.2k" = 1200 and "rice 2k" = 2000.
- Singlish "k" is the Sinhala suffix "ක්", NOT thousand: when a number with k is followed by another number, it is a QUANTITY ("pol 3k 360" = coconut x3 for 360, "biththara 10k 550" = eggs x10 for 550), and in Singlish sentences ("500k dunna", "1500k gewwa") it means just the number (500, 1500).
- Put quantities in the item name only when the message states one: "coconut x3". Never add a quantity that is not written.
- If one price covers several things ("rice and dhal 1500"), make ONE item "rice and dhal".
- "paidBy": a member name only if the message says someone else paid ("Kasun bought bread 200"). Otherwise null (the speaker paid).
- "splitWith": member names only if the message limits who shares the cost ("shampoo for me and Nimal 800"). Include the speaker if they say "me". Empty list means everyone shares.
- "settlement": the speaker paid back money they owed to a member ("gave Kasun 1500", "Nimal ta 500k dunna"). Set settleTo and settleAmount.
- "question": asking about spending, balances, who owes what, averages, history.
- "other": greetings or anything else. Put a short friendly reply in "reply". If they mention buying something but no price, ask for the price in "reply".
- Never invent prices. Amounts are plain numbers.`;
}

function matchMember(name: string | null | undefined, members: Member[], speaker: Member): Member | null {
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

const validAmount = (a: number) => Number.isFinite(a) && a > 0 && a < 10_000_000;

export async function parseMessage(
  text: string,
  members: Member[],
  speaker: Member,
  currency: string,
  imageBase64?: string,
): Promise<Parsed> {
  const userContent = imageBase64
    ? `${text || ""}\n\n[A photo of a shop receipt or bill is attached. Treat it as an expense and list every purchased item with its price. Ignore totals, tax lines, change and cash given.]`
    : text;

  try {
    const raw = await complete(
      [
        { role: "system", content: systemPrompt(members, speaker, currency) },
        { role: "user", content: userContent, imageBase64 },
      ],
      { json: true },
    );
    const p = parsedSchema.parse(extractJson(raw));
    const splitAmong = p.splitWith
      .map((n) => matchMember(n, members, speaker))
      .filter((m): m is Member => !!m);
    // The model sometimes drops the speaker from "for me and Nimal"; the words are unambiguous, so add them back.
    if (splitAmong.length && /\b(me|us|we|myself|mata|mama|apita|api)\b/i.test(text)) splitAmong.push(speaker);
    return {
      intent: p.intent,
      items: p.items
        .map((i) => ({ name: i.name.trim(), amount: Math.round(i.amount * 100) / 100 }))
        .filter((i) => validAmount(i.amount)),
      paidBy: matchMember(p.paidBy, members, speaker) ?? speaker,
      splitAmong: splitAmong.length ? [...new Map(splitAmong.map((m) => [m.id, m])).values()] : members,
      settleTo: matchMember(p.settleTo, members, speaker),
      settleAmount: p.settleAmount && validAmount(p.settleAmount) ? p.settleAmount : null,
      reply: p.reply ?? null,
      usedFallback: false,
    };
  } catch (err) {
    console.error("[parse] model unavailable, using fallback parser:", err);
    return fallbackParse(text, members, speaker);
  }
}

/** Rule-based backup so the room keeps working when the model is offline. */
export function fallbackParse(text: string, members: Member[], speaker: Member): Parsed {
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
