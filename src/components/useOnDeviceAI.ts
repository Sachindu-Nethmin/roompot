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

const CONSENT_KEY = "roompot:on-device-ai";

function rememberConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, "1");
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
export function useOnDeviceAI(enabled: boolean) {
  const [status, setStatus] = useState<AIStatus>({ phase: enabled ? "checking" : "off" });
  const engineRef = useRef<MLCEngineInterface | null>(null);

  const start = useCallback(async (modelId: string) => {
    rememberConsent();
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

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const { checkSupport, isModelCached } = await import("@/lib/browser-ai");
      const support = await checkSupport();
      if (cancelled) return;
      if (!support.ok) return setStatus({ phase: "unsupported", reason: support.reason });
      // Already downloaded on this device (or the user opted in before): load without asking again.
      if (hasConsent() || (await isModelCached(support.modelId))) {
        if (!cancelled) start(support.modelId);
      } else if (!cancelled) {
        setStatus({ phase: "idle", modelId: support.modelId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, start]);

  return { status, engine: engineRef, start };
}
