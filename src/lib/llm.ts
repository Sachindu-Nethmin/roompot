/**
 * Thin client for an open-weight model.
 *
 * - LLM_PROVIDER=ollama (default): talks to a local Ollama server, e.g. `gemma4:E4B`.
 * - LLM_PROVIDER=openai: any OpenAI-compatible endpoint serving an open model
 *   (Google AI Studio's Gemma, vLLM, llama.cpp server, LM Studio, ...).
 * - LLM_PROVIDER=browser: no model on the server. Each phone runs Gemma itself with WebLLM.
 */

export const provider = process.env.LLM_PROVIDER ?? "ollama";
const baseUrl = (process.env.LLM_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.env.LLM_MODEL ?? "gemma4:E4B";
const apiKey = process.env.LLM_API_KEY ?? "";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string; imageBase64?: string };

export const modelName = model;

export async function complete(messages: ChatMsg[], opts: { json?: boolean } = {}): Promise<string> {
  const signal = AbortSignal.timeout(90_000);

  if (provider === "ollama") {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        format: opts.json ? "json" : undefined,
        options: { temperature: 0.1 },
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          images: m.imageBase64 ? [m.imageBase64] : undefined,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.message?.content ?? "";
  }

  const call = (msgs: ChatMsg[]) =>
    fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: msgs.map((m) => ({
          role: m.role,
          content: m.imageBase64
            ? [
                { type: "text", text: m.content },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${m.imageBase64}` } },
              ]
            : m.content,
        })),
      }),
    });

  let res = await call(messages);
  // Some hosts serve Gemma without a system role; resend with the instructions inside the user turn.
  if (res.status === 400 && messages[0]?.role === "system" && messages.length > 1) {
    const detail = await res.text();
    if (!/system|developer|instruction/i.test(detail)) throw new Error(`LLM 400: ${detail}`);
    const [sys, first, ...rest] = messages;
    res = await call([{ ...first, content: `${sys.content}\n\n${first.content}` }, ...rest]);
  }
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return stripThinking(data.choices?.[0]?.message?.content ?? "");
}

/** Drops reasoning blocks that some open models put before their answer. */
function stripThinking(text: string) {
  return text.replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, "").trim();
}
