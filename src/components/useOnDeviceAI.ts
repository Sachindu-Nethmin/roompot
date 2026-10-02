"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MLCEngineInterface } from "@mlc-ai/web-llm";

export type AIStatus =
  | { phase: "off" }
  | { phase: "checking" }
  | { phase: "unsupported"; reason: string }
  | { phase: "idle"; modelId: string }
  | { phase: "loading"; modelId: string; progress: number; text: string }
  | { phase: "ready"; modelId: string }
  | { phase: "error"; modelId: string; message: string };

/**
 * "required": the server has no model, so on-device AI is the only AI (offered to everyone who can run it).
 * "optional": the server runs the model; on-device is an opt-in private mode.
 */
export type AIMode = "off" | "optional" | "required";

const CONSENT_KEY = "roompot:on-device-ai";

function setConsent(on: boolean) {
  try {
    if (on) localStorage.setItem(CONSENT_KEY, "1");
    else localStorage.removeItem(CONSENT_KEY);
  } catch {}
}
function hasConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Manages the in-browser Gemma model: support check, one-time download, and the loaded engine. */
export function useOnDeviceAI(mode: AIMode) {
  const [status, setStatus] = useState<AIStatus>({ phase: mode === "off" ? "off" : "checking" });
  const engineRef = useRef<MLCEngineInterface | null>(null);

  const start = useCallback(async (modelId: string) => {
    setConsent(true);
    setStatus({ phase: "loading", modelId, progress: 0, text: "Starting…" });
    const { loadEngine } = await import("@/lib/browser-ai");
    // Downloaded pieces stay cached, so on a flaky connection each retry picks up where the last one stopped.
    for (let attempt = 1; ; attempt++) {
      try {
        engineRef.current = await loadEngine(modelId, (r) =>
          setStatus({ phase: "loading", modelId, progress: r.progress, text: r.text }),
        );
        setStatus({ phase: "ready", modelId });
        return;
      } catch (err) {
        const message = (err as Error).message;
        if (attempt < 5 && /network|fetch|load failed/i.test(message)) {
          setStatus({ phase: "loading", modelId, progress: 0, text: `Connection dropped, retrying (${attempt}/4)…` });
          await new Promise((r) => setTimeout(r, 3000 * attempt));
          continue;
        }
        setStatus({ phase: "error", modelId, message });
        return;
      }
    }
  }, []);

  /** Turns private mode off. The download stays cached, so turning it back on is quick. */
  const stop = useCallback((modelId: string) => {
    setConsent(false);
    engineRef.current = null;
    setStatus({ phase: "idle", modelId });
  }, []);

  useEffect(() => {
    if (mode === "off") return;
    let cancelled = false;
    (async () => {
      const { checkSupport, isModelCached } = await import("@/lib/browser-ai");
      const support = await checkSupport();
      if (cancelled) return;
      if (!support.ok) return setStatus({ phase: "unsupported", reason: support.reason });
      const resume = hasConsent() || (mode === "required" && (await isModelCached(support.modelId)));
      if (cancelled) return;
      if (resume) start(support.modelId);
      else setStatus({ phase: "idle", modelId: support.modelId });
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, start]);

  return { status, engine: engineRef, start, stop };
}
