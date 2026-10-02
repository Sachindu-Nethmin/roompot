import { complete, provider } from "./llm";
import { RECEIPT_NOTE, extractJson, fallbackParse, normalizeParsed, systemPrompt, type Member, type Parsed } from "./extract";

export type { Member, Parsed };

/** Server-side parsing with Ollama or a hosted open model. In browser mode the model runs on the client instead. */
export async function parseMessage(
  text: string,
  members: Member[],
  speaker: Member,
  currency: string,
  imageBase64?: string,
): Promise<Parsed> {
  if (provider === "browser") return fallbackParse(text, members, speaker);

  const userContent = imageBase64 ? `${text || ""}\n\n${RECEIPT_NOTE}` : text;
  try {
    const raw = await complete(
      [
        { role: "system", content: systemPrompt(members, speaker, currency) },
        { role: "user", content: userContent, imageBase64 },
      ],
      { json: true },
    );
    return normalizeParsed(extractJson(raw), text, members, speaker);
  } catch (err) {
    console.error("[parse] model unavailable, using fallback parser:", err);
    return fallbackParse(text, members, speaker);
  }
}
