export const fallbackHost =
  typeof globalThis !== "undefined" && "location" in globalThis && globalThis.location
    ? globalThis.location.hostname
    : "localhost";

function inferDefaultApiBase() {
  if (!(typeof globalThis !== "undefined" && "location" in globalThis && globalThis.location)) {
    return `http://${fallbackHost}:8000`;
  }

  const { hostname, protocol } = globalThis.location;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  const isLanIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);

  if (isLocalhost || isLanIp) {
    return `http://${hostname}:8000`;
  }

  if (hostname === "app.northstonecrm.com" || hostname === "northstonecrm.com" || hostname === "www.northstonecrm.com") {
    return "https://api.northstonecrm.com";
  }

  if (hostname.endsWith(".northstonecrm.com")) {
    return "https://api.northstonecrm.com";
  }

  return `${protocol}//${hostname}:8000`;
}

const defaultApiBase = inferDefaultApiBase();
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? defaultApiBase).replace(/\/$/, "");
const API_KEY = import.meta.env.VITE_API_KEY ?? "";
const TOKEN_KEY = "northstonecrm_token";
const EMAIL_KEY = "northstonecrm_email";
const LEGACY_TOKEN_KEY = "dealios_token";
const LEGACY_EMAIL_KEY = "dealios_email";

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(LEGACY_TOKEN_KEY) ?? "";
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

function backendFailureMessage(path: string, timeoutMs: number, error: unknown) {
  if (error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError") {
    return `Request to ${path} timed out after ${Math.round(timeoutMs / 1000)}s. Backend may still be starting or processing a slow request.`;
  }
  return `Request to ${API_BASE_URL}${path} failed before the browser received a usable response. Check the backend logs for a 500/CORS-side crash.`;
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
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_EMAIL_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
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
  const timeoutMs =
    path.startsWith("/enterprise/builder-documents/generate")
      ? 60000
      : path.startsWith("/auth/") || path.startsWith("/admin/") || path.startsWith("/enterprise/audit")
        ? 20000
        : 8000;
  let res: Response;
  try {
    res = await request(path, { ...init, headers }, timeoutMs);
  } catch (e) {
    throw new ApiError(0, backendFailureMessage(path, timeoutMs, e));
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
    throw new ApiError(0, backendFailureMessage(path, timeoutMs, e));
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
    throw new ApiError(0, backendFailureMessage(path, timeoutMs, e));
  }
  await throwIfNotOk(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
