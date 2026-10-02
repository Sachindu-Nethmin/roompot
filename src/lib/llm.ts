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

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    signal,
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: messages.map((m) => ({
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
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
