import { useEffect, useState } from "react";
import { API_BASE_URL } from "../api/client";

export type BackendStatus = "checking" | "up" | "down";

export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;

    async function ping(delayMs: number) {
      if (cancelled) return;
      try {
        const res = await fetch(`${API_BASE_URL}/health`, { method: "GET" });
        if (!cancelled) setStatus(res.ok ? "up" : "down");
      } catch {
        if (!cancelled) setStatus("down");
      }
      timeout = globalThis.setTimeout(() => void ping(status === "up" ? 5000 : 1500), delayMs);
    }

    void ping(0);
    return () => {
      cancelled = true;
      if (timeout) globalThis.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, apiBaseUrl: API_BASE_URL };
}

