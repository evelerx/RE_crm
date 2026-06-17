// In-memory GET response cache — survives route changes, expires after 45s.
// Any mutating request (POST/PATCH/DELETE) clears the entire cache.
import type {
  AdminMarketingRequestRow,
  AdminMarketingAccessRecord,
  MarketingAccount,
  MarketingAccountAllotment,
  MarketingAccountCreatePayload,
  MarketingActivityLogEntry,
  MarketingAddonStatusResponse,
  MarketingMetrics,
  MarketingNotification,
  MarketingRequestCreatePayload,
  MarketingRequestDetail,
  MarketingRequestSummary,
  MarketingWorkspaceAccess,
} from "../types/marketing";

const _apiCache = new Map<string, { data: unknown; exp: number }>();
const _CACHE_TTL = 45_000;

// Paths that should never be cached
const _SKIP_CACHE_PREFIXES = [
  "/auth/",
  "/admin/",
  "/ai/",
  "/whatsapp/",
  "/enterprise/builder-documents/generate",
  "/enterprise/builder-website",
];

function _isCacheable(path: string, method: string): boolean {
  if (method !== "GET") return false;
  return !_SKIP_CACHE_PREFIXES.some((p) => path.startsWith(p));
}

function _mkKey(path: string): string {
  const t = getToken();
  return `${t.length > 8 ? t.slice(-8) : t}|${path}`;
}

export function invalidateCache(): void {
  _apiCache.clear();
}

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
    _apiCache.clear();
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
  const method = (init.method ?? "GET").toUpperCase();
  const cacheKey = _isCacheable(path, method) ? _mkKey(path) : null;

  if (cacheKey) {
    const hit = _apiCache.get(cacheKey);
    if (hit && hit.exp > Date.now()) return hit.data as T;
  }

  const headers = buildHeaders(init, "application/json");
  const timeoutMs =
    path.startsWith("/enterprise/builder-documents/generate")
      || path.startsWith("/enterprise/builder-website")
      ? 60000
      : 25000;
  let res: Response;
  try {
    res = await request(path, { ...init, headers }, timeoutMs);
  } catch (e) {
    throw new ApiError(0, backendFailureMessage(path, timeoutMs, e));
  }
  await throwIfNotOk(res);
  if (res.status === 204) return undefined as T;
  const data = (await res.json()) as T;

  if (cacheKey) {
    _apiCache.set(cacheKey, { data, exp: Date.now() + _CACHE_TTL });
  } else if (method !== "GET") {
    _apiCache.clear();
  }

  return data;
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

export type WhatsAppMediaSendResponse = {
  ok: boolean;
  contact_id: string;
  status: string;
  wa_message_id: string;
};

export type WhatsAppMessageRead = import("./types").WhatsAppMessage;
export type WhatsAppConversationSummaryRead = import("./types").WhatsAppConversationSummary;
export type WhatsAppConversationRead = import("./types").WhatsAppConversation;
export type WhatsAppConfigStatusRead = import("./types").WhatsAppConfigStatus;

export async function sendWhatsAppMessage(contactId: string, message: string) {
  return api<WhatsAppMessageRead>("/whatsapp/send", {
    method: "POST",
    body: JSON.stringify({ contact_id: contactId, message }),
  });
}

export async function listDealWhatsAppMessages(dealId: string) {
  return api<WhatsAppMessageRead[]>(`/whatsapp/messages/${dealId}`);
}

export async function listWhatsAppInbox() {
  return api<WhatsAppConversationSummaryRead[]>("/whatsapp/inbox");
}

export async function getWhatsAppConversation(contactId: string) {
  return api<WhatsAppConversationRead>(`/whatsapp/conversation/${contactId}`);
}

export async function getWhatsAppConfigStatus() {
  return api<WhatsAppConfigStatusRead>("/whatsapp/config-status");
}

export async function getMarketingWorkspace() {
  return api<MarketingWorkspaceAccess>("/marketing/workspace");
}

export async function getMarketingAddonStatus() {
  return api<MarketingAddonStatusResponse>("/marketing/addon");
}

export async function getMarketingMetrics() {
  return api<MarketingMetrics>("/marketing/metrics");
}

export async function listMarketingRequests() {
  return api<MarketingRequestSummary[]>("/marketing/requests");
}

export async function getMarketingRequest(requestId: string) {
  return api<MarketingRequestDetail>(`/marketing/requests/${requestId}`);
}

export async function createMarketingRequest(payload: MarketingRequestCreatePayload) {
  return api<MarketingRequestDetail>("/marketing/requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function addMarketingComment(requestId: string, message: string, taskId?: string | null) {
  return api<MarketingRequestDetail["comments"][number]>(`/marketing/requests/${requestId}/comments`, {
    method: "POST",
    body: JSON.stringify({ message, task_id: taskId ?? null }),
  });
}

export async function listMarketingApprovals(requestId: string) {
  return api<MarketingRequestDetail["approvals"]>(`/marketing/requests/${requestId}/approvals`);
}

export async function ownerSignOffMarketingApproval(approvalId: string, action: "approved" | "changes_requested" | "rejected", note = "") {
  return api<MarketingRequestDetail["approvals"][number]>(`/marketing/approvals/${approvalId}/owner-sign-off`, {
    method: "PATCH",
    body: JSON.stringify({ action, note }),
  });
}

export async function listMarketingNotifications() {
  return api<MarketingNotification[]>("/marketing/notifications");
}

export async function markMarketingNotificationRead(notificationId: string) {
  return api<{ ok: boolean }>(`/marketing/notifications/${notificationId}/read`, {
    method: "PATCH",
  });
}

export async function listMarketingActivity(requestId: string) {
  return api<MarketingActivityLogEntry[]>(`/marketing/requests/${requestId}/activity`);
}

export async function listAdminMarketingAccounts() {
  return api<MarketingAccount[]>("/admin/marketing/accounts");
}

export async function createAdminMarketingAccount(payload: MarketingAccountCreatePayload) {
  return api<MarketingAccount>("/admin/marketing/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function allotAdminMarketingAccount(accountId: string, enterpriseOwnerId: string, notes = "") {
  return api<MarketingAccount>(`/admin/marketing/accounts/${accountId}/allot`, {
    method: "POST",
    body: JSON.stringify({ enterprise_owner_id: enterpriseOwnerId, notes }),
  });
}

export async function revokeAdminMarketingAccount(accountId: string, notes = "") {
  return api<MarketingAccount>(`/admin/marketing/accounts/${accountId}/revoke`, {
    method: "POST",
    body: JSON.stringify({ notes }),
  });
}

export async function listAdminMarketingAccountAudit() {
  return api<MarketingAccountAllotment[]>("/admin/marketing/accounts/audit");
}

export async function listAdminMarketingRequests(status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return api<AdminMarketingRequestRow[]>(`/admin/marketing/requests${query}`);
}

export async function listAdminMarketingAccess() {
  return api<AdminMarketingAccessRecord[]>("/admin/marketing/access");
}

export async function setAdminMarketingAccess(payload: {
  email: string;
  marketing_portal_enabled: boolean;
  addon_type: "none" | "marketing_assist" | "managed_marketing" | "ai_brand";
  billing_term_months: number;
}) {
  return api<{ ok: boolean; message: string; record: AdminMarketingAccessRecord }>("/admin/marketing/access", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendWhatsAppMedia(contactId: string, caption: string, file: File) {
  const formData = new FormData();
  formData.append("contact_id", contactId);
  formData.append("caption", caption);
  formData.append("file", file);
  return apiForm<WhatsAppMediaSendResponse>("/whatsapp/send-media", formData);
}

export async function uploadDealImages(dealId: string, files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  return apiForm("/deals/" + dealId + "/images/", formData) as Promise<import("./types").DealImage[]>;
}

export async function listDealImages(dealId: string) {
  return api<import("./types").DealImage[]>("/deals/" + dealId + "/images/");
}

export async function deleteDealImage(dealId: string, imageId: string) {
  return api<{ deleted: boolean }>("/deals/" + dealId + "/images/" + imageId, { method: "DELETE" });
}

export async function setPrimaryDealImage(dealId: string, imageId: string) {
  return api<import("./types").DealImage[]>("/deals/" + dealId + "/images/" + imageId + "/set-primary", {
    method: "PATCH",
  });
}

export async function closeDeal(dealId: string, closure_note: string) {
  return api<import("./types").Deal>("/deals/" + dealId + "/close", {
    method: "PATCH",
    body: JSON.stringify({ closure_note }),
  });
}

export async function closureFeed() {
  return api<import("./types").DealClosureEvent[]>("/deals/closure-feed");
}

export async function getDefaultSequence() {
  return api<import("./types").FollowUpSequence>("/sequences/default");
}

export async function saveDefaultSequence(payload: {
  name: string;
  steps: import("./types").SequenceStep[];
}) {
  return api<import("./types").FollowUpSequence>("/sequences/default", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
