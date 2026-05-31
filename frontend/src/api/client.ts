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
      || path.startsWith("/enterprise/builder-website")
      || path.startsWith("/telephony/")
      || path.startsWith("/inventory/")
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

export type WhatsAppMediaSendResponse = {
  ok: boolean;
  contact_id: string;
  status: string;
  wa_message_id: string;
};

export async function listWhatsAppMessages(dealId: string) {
  return api<import("./types").WhatsAppMessage[]>("/whatsapp/messages/" + dealId);
}

export async function listWhatsAppConversation(contactId: string) {
  return api<import("./types").WhatsAppMessage[]>("/whatsapp/conversation/" + contactId);
}

export async function sendWhatsAppMessage(contactId: string, message: string, dealId?: string) {
  return api<WhatsAppMediaSendResponse>("/whatsapp/send", {
    method: "POST",
    body: JSON.stringify({
      contact_id: contactId,
      deal_id: dealId ?? null,
      message,
    }),
  });
}

export async function sendWhatsAppMedia(contactId: string, caption: string, file: File, dealId?: string) {
  const formData = new FormData();
  formData.append("contact_id", contactId);
  if (dealId) formData.append("deal_id", dealId);
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

export async function getLeadCaptureOverview() {
  return api<import("./types").LeadCaptureOverview>("/integrations/lead-sources");
}

export async function saveLeadCaptureMapping(
  payload: {
    platform: "facebook" | "google";
    platform_id: string;
    access_token: string;
  },
) {
  return api<import("./types").IntegrationMapping>("/integrations/lead-sources/mappings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteLeadCaptureMapping(mappingId: string) {
  return api<{ deleted: boolean }>("/integrations/lead-sources/mappings/" + mappingId, {
    method: "DELETE",
  });
}

export async function createWebhookEndpoint(payload: { name: string; field_mapping: Record<string, string> }) {
  return api<import("./types").WebhookEndpoint>("/webhooks/endpoints", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listWebhookEndpoints() {
  return api<import("./types").WebhookEndpoint[]>("/webhooks/endpoints");
}

export async function updateWebhookEndpoint(endpointId: string, payload: Partial<{ name: string; is_active: boolean; field_mapping: Record<string, string> }>) {
  return api<import("./types").WebhookEndpoint>("/webhooks/endpoints/" + endpointId, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deactivateWebhookEndpoint(endpointId: string) {
  return api<{ deleted: boolean }>("/webhooks/endpoints/" + endpointId, {
    method: "DELETE",
  });
}

export async function listWebhookLogs(endpointId: string) {
  return api<import("./types").WebhookLog[]>("/webhooks/logs/" + endpointId);
}

export async function getGoogleCalendarStatus() {
  return api<import("./types").GoogleCalendarSyncStatus>("/integrations/google/calendar-status");
}

export async function getGoogleCalendarAuthUrl() {
  return api<{ provider: string; auth_url: string }>("/integrations/google/auth-url");
}

export async function toggleGoogleCalendarSync(syncEnabled: boolean) {
  return api<import("./types").GoogleCalendarSyncStatus>("/integrations/google/calendar-status", {
    method: "PATCH",
    body: JSON.stringify({ sync_enabled: syncEnabled }),
  });
}

export async function syncAllGoogleCalendarActivities() {
  return api<{ ok: boolean; synced_count: number; skipped_count: number; updated_activity_ids: string[] }>("/integrations/google/sync-all", {
    method: "POST",
  });
}

export async function initiateCall(payload: { to_number: string; deal_id?: string | null; contact_id?: string | null }) {
  return api<import("./types").CallRecord>("/telephony/call/initiate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listDealCalls(dealId: string) {
  return api<import("./types").CallRecord[]>("/telephony/calls/" + dealId);
}

export async function listCalls(params: { status?: string; deal_id?: string; from_date?: string; to_date?: string; page?: number; page_size?: number } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.deal_id) query.set("deal_id", params.deal_id);
  if (params.from_date) query.set("from_date", params.from_date);
  if (params.to_date) query.set("to_date", params.to_date);
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  return api<import("./types").CallRecord[]>(`/telephony/calls${query.toString() ? `?${query.toString()}` : ""}`);
}

export async function createInventoryProject(payload: { name: string; location: string; total_units: number; launch_date?: string | null }) {
  return api<import("./types").InventoryProject>("/inventory/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listInventoryProjects() {
  return api<import("./types").InventoryProject[]>("/inventory/projects");
}

export async function bulkCreateInventoryUnits(
  projectId: string,
  payload: Array<{
    unit_number: string;
    tower?: string | null;
    floor?: number | null;
    bhk_type: string;
    area_sqft: number;
    base_price: number;
    status: string;
  }>,
) {
  return api<import("./types").InventoryUnit[]>(`/inventory/projects/${projectId}/units`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listInventoryUnits(projectId: string, params: { status?: string; bhk_type?: string; floor?: number; tower?: string } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.bhk_type) query.set("bhk_type", params.bhk_type);
  if (params.floor != null) query.set("floor", String(params.floor));
  if (params.tower) query.set("tower", params.tower);
  return api<import("./types").InventoryUnit[]>(`/inventory/projects/${projectId}/units${query.toString() ? `?${query.toString()}` : ""}`);
}

export async function updateInventoryUnit(unitId: string, payload: { status?: string; current_price?: number | null; deal_id?: string | null }) {
  return api<import("./types").InventoryUnit>(`/inventory/units/${unitId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function bookInventoryUnit(unitId: string, deal_id: string) {
  return api<import("./types").InventoryUnit>(`/inventory/units/${unitId}/book`, {
    method: "POST",
    body: JSON.stringify({ deal_id }),
  });
}

export async function getInventoryProjectSummary(projectId: string) {
  return api<import("./types").InventoryProjectSummary>(`/inventory/projects/${projectId}/summary`);
}
