/**
 * On-device AI: Gemma running in the browser with WebLLM (WebGPU), and Tesseract.js for receipts.
 * Messages and photos are processed on the phone; only the extracted items reach the server.
 */
import type { InitProgressReport, MLCEngineInterface } from "@mlc-ai/web-llm";
import { OUTPUT_JSON_SCHEMA, RECEIPT_NOTE, extractJson, systemPrompt, type Member } from "./extract";

/** Gemma 2 2B: needs GPUs with 16-bit float shaders (most recent phones and laptops). */
const MODEL_F16 = "gemma-2-2b-it-q4f16_1-MLC";
/** Same model with 32-bit shaders, for GPUs without shader-f16. */
const MODEL_F32 = "gemma-2-2b-it-q4f32_1-MLC";

type GPUAdapterLike = { features: Set<string> };
type NavigatorGPU = { gpu?: { requestAdapter(): Promise<GPUAdapterLike | null> } };

export type Support = { ok: true; modelId: string } | { ok: false; reason: string };

export async function checkSupport(): Promise<Support> {
  const gpu = (navigator as unknown as NavigatorGPU).gpu;
  if (!gpu) return { ok: false, reason: "This browser has no WebGPU" };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: "No compatible GPU found" };
    return { ok: true, modelId: adapter.features.has("shader-f16") ? MODEL_F16 : MODEL_F32 };
  } catch {
    return { ok: false, reason: "WebGPU is blocked on this device" };
  }
}

export async function isModelCached(modelId: string) {
  const { hasModelInCache } = await import("@mlc-ai/web-llm");
  return hasModelInCache(modelId).catch(() => false);
}

let engine: Promise<MLCEngineInterface> | null = null;

export function loadEngine(modelId: string, onProgress: (r: InitProgressReport) => void) {
  // Main-thread engine: the heavy lifting happens on the GPU, so the page stays responsive.
  engine ??= import("@mlc-ai/web-llm")
    .then(({ CreateMLCEngine }) => CreateMLCEngine(modelId, { initProgressCallback: onProgress }))
    .catch((err) => {
      engine = null;
      throw err;
    });
  return engine;
}

/** Returns the model's raw JSON; the server validates it before saving anything. */
export async function extractOnDevice(
  e: MLCEngineInterface,
  text: string,
  members: Member[],
  speaker: Member,
  currency: string,
  receipt = false,
) {
  // Gemma has no separate system role, so the instructions travel in the user turn.
  const content = `${systemPrompt(members, speaker, currency)}\n\nMessage from ${speaker.name}:\n${text}${receipt ? `\n\n${RECEIPT_NOTE}` : ""}`;
  const res = await e.chat.completions.create({
    messages: [{ role: "user", content }],
    temperature: 0,
    max_tokens: 500,
    response_format: { type: "json_object", schema: JSON.stringify(OUTPUT_JSON_SCHEMA) },
  });
  return extractJson(res.choices[0]?.message?.content ?? "");
}

export async function answerOnDevice(e: MLCEngineInterface, instructions: string, question: string) {
  const res = await e.chat.completions.create({
    messages: [{ role: "user", content: `${instructions}\n\nQuestion: ${question}` }],
    temperature: 0.2,
    max_tokens: 220,
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

/** Reads the text off a receipt photo, on the device. */
export async function readReceipt(imageDataUrl: string) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(imageDataUrl);
    return data.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
  } finally {
    await worker.terminate();
  }
}
