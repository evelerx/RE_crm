export const fallbackHost =
  typeof globalThis !== "undefined" && "location" in globalThis && globalThis.location
    ? globalThis.location.hostname
    : "localhost";
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? `http://${fallbackHost}:8000`;
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

function getToken() {
  try {
    return localStorage.getItem("dealios_token") ?? "";
  } catch {
    return "";
  }
}

export class ApiError extends Error {
  status: number;
  raw?: string;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function buildHeaders(init: RequestInit, contentType: string | null) {
  const headers = new Headers(init.headers);
  if (contentType) headers.set("Content-Type", contentType);
  if (API_KEY) headers.set("X-API-Key", API_KEY);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function throwIfNotOk(res: Response) {
  if (res.ok) return;
  if (res.status === 401) {
    try {
      localStorage.removeItem("dealios_email");
      localStorage.removeItem("dealios_token");
    } catch {
      // ignore
    }
  }
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  let message = text || res.statusText;
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed === "object" && parsed !== null && "detail" in parsed) {
        const detail = (parsed as { detail?: unknown }).detail;
        if (detail != null) message = String(detail);
      }
    } catch {
      // ignore parse errors
    }
  }
  const err = new ApiError(res.status, message);
  err.raw = text;
  throw err;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = buildHeaders(init, "application/json");
  const timeoutMs = path.startsWith("/auth/") ? 20000 : 8000;
  let res: Response;
  try {
    res = await request(path, { ...init, headers }, timeoutMs);
  } catch (e) {
    const msg =
      e && typeof e === "object" && "name" in e && (e as { name?: string }).name === "AbortError"
        ? `Request timed out after ${Math.round(timeoutMs / 1000)}s. Backend may still be starting.`
        : `Cannot reach backend at ${API_BASE_URL}. Make sure backend is running.`;
    throw new ApiError(0, msg);
  }
  await throwIfNotOk(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const headers = buildHeaders(init, null);
  const timeoutMs = 20000;
  let res: Response;
  try {
    res = await request(path, { ...init, headers }, timeoutMs);
  } catch (e) {
    const msg =
      e && typeof e === "object" && "name" in e && (e as { name?: string }).name === "AbortError"
        ? `Request timed out after ${Math.round(timeoutMs / 1000)}s.`
        : `Cannot reach backend at ${API_BASE_URL}. Make sure backend is running.`;
    throw new ApiError(0, msg);
  }
  await throwIfNotOk(res);
  return await res.blob();
}

export async function apiForm<T>(path: string, formData: FormData, init: RequestInit = {}): Promise<T> {
  const headers = buildHeaders(init, null);
  const timeoutMs = 20000;
  let res: Response;
  try {
    res = await request(path, { ...init, method: init.method ?? "POST", headers, body: formData }, timeoutMs);
  } catch (e) {
    const msg =
      e && typeof e === "object" && "name" in e && (e as { name?: string }).name === "AbortError"
        ? `Request timed out after ${Math.round(timeoutMs / 1000)}s.`
        : `Cannot reach backend at ${API_BASE_URL}. Make sure backend is running.`;
    throw new ApiError(0, msg);
  }
  await throwIfNotOk(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
