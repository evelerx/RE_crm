import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../api/client";

export type BackendStatus = "checking" | "up" | "down";

export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const statusRef = useRef<BackendStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;

    async function ping(delayMs: number) {
      if (cancelled) return;
      try {
        const res = await fetch(`${API_BASE_URL}/health`, { method: "GET" });
        const nextStatus = res.ok ? "up" : "down";
        if (!cancelled) {
          statusRef.current = nextStatus;
          setStatus(nextStatus);
        }
      } catch {
        if (!cancelled) {
          statusRef.current = "down";
          setStatus("down");
        }
      }
      timeout = globalThis.setTimeout(() => void ping(statusRef.current === "up" ? 5000 : 1500), delayMs);
    }

    void ping(0);
    return () => {
      cancelled = true;
      if (timeout) globalThis.clearTimeout(timeout);
    };
  }, []);

  return { status, apiBaseUrl: API_BASE_URL };
}
