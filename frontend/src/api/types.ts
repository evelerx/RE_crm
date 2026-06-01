export type Stage = "lead" | "visit" | "negotiation" | "closed" | "lost";
export type AssetType = "residential" | "commercial" | "land" | "industrial" | "other";

export type Deal = {
  id: string;
  title: string;
  asset_type: AssetType;
  stage: Stage;
  city: string;
  area: string;
  visit_date: string | null;
  typology: string;
  ticket_size: number | null;
  customer_budget: number | null;
  expected_yield_pct: number | null;
  expected_roi_pct: number | null;
  liquidity_days_est: number | null;
  client_phase: "" | "hot" | "warm" | "cold" | "lost";
  close_probability: number | null;
  risk_flags: string;
  contact_id: string | null;
  notes: string;
  status: "open" | "closed" | "lost";
  closed_by_user_name: string;
  closed_at: string | null;
  closure_note: string;
  primary_image_url: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DealCreate = Partial<Omit<Deal, "id" | "created_at" | "updated_at" | "last_activity_at">> & {
  title: string;
};

export type Contact = {
  id: string;
  name: string;
  occupation: string;
  phone: string | null;
  email: string | null;
  role: string;
  tags: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type ContactCreate = {
  name: string;
  occupation?: string;
  phone?: string | null;
  email?: string | null;
  role?: string;
  tags?: string;
  notes?: string;
};

export type Activity = {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  kind: string;
  summary: string;
  due_at: string | null;
  completed: boolean;
  google_event_id?: string;
  created_at: string;
};

export type DealImage = {
  id: string;
  deal_id: string;
  image_url: string;
  filename: string;
  uploaded_at: string;
  is_primary: boolean;
};

export type DealClosureEvent = {
  id: string;
  deal_id: string;
  deal_title: string;
  property_name: string;
  closed_by_name: string;
  closed_at: string;
};

export type WhatsAppMessage = {
  id: string;
  contact_id: string;
  deal_id: string | null;
  direction: "inbound" | "outbound";
  message_body: string;
  timestamp: string;
  status: "sent" | "delivered" | "read" | "failed";
  wa_message_id: string;
  read_at: string | null;
};

export type Profile = {
  id: string;
  owner_id: string;
  full_name: string;
  phone: string | null;
  whatsapp: string | null;
  company: string;
  city: string;
  areas_served: string;
  specialization: string;
  rera_id: string;
  pan: string;
  gstin: string;
  languages: string;
  bio: string;
  created_at: string;
  updated_at: string;
};

export type IntegrationMapping = {
  id: string;
  owner_id: string;
  platform: "facebook" | "google";
  platform_id: string;
  created_at: string;
  updated_at: string;
};

export type LeadCaptureRecentLead = {
  deal_id: string;
  contact_id: string | null;
  contact_name: string;
  contact_phone: string;
  source: "facebook_ads" | "google_ads" | "manual" | string;
  created_at: string;
};

export type LeadCaptureOverview = {
  mappings: IntegrationMapping[];
  counts: Record<string, number>;
  recent_by_source: Record<string, LeadCaptureRecentLead[]>;
};

export type WebhookEndpoint = {
  id: string;
  owner_id: string;
  name: string;
  webhook_key: string;
  field_mapping: Record<string, string>;
  is_active: boolean;
  created_at: string;
  last_triggered_at: string | null;
};

export type WebhookLog = {
  id: string;
  endpoint_id: string;
  payload_preview: string;
  status: "ok" | "error";
  created_contact_id: string | null;
  created_deal_id: string | null;
  error_message: string;
  created_at: string;
};

export type GoogleCalendarSyncStatus = {
  connected: boolean;
  auth_url: string;
  connected_email: string;
  sync_enabled: boolean;
  token_expiry: string | null;
  last_sync_at: string | null;
  synced_events_count: number;
};

export type CallRecord = {
  id: string;
  owner_id: string;
  initiated_by_user_id: string | null;
  deal_id: string | null;
  contact_id: string | null;
  call_sid: string;
  status: "initiated" | "ringing" | "in-progress" | "completed" | "failed" | string;
  duration_seconds: number | null;
  recording_url: string | null;
  started_at: string;
  ended_at: string | null;
  deal_title: string;
  contact_name: string;
};

export type InventoryProject = {
  id: string;
  owner_id: string;
  name: string;
  location: string;
  total_units: number;
  launch_date: string | null;
  created_at: string;
};

export type InventoryUnit = {
  id: string;
  project_id: string;
  unit_number: string;
  tower: string | null;
  floor: number | null;
  bhk_type: string;
  area_sqft: number;
  base_price: number;
  current_price: number | null;
  status: "available" | "blocked" | "booked" | "sold" | string;
  deal_id: string | null;
  booked_by: string | null;
  booked_at: string | null;
  deal_title: string;
};

export type InventoryProjectSummary = {
  total_units: number;
  available_count: number;
  booked_count: number;
  sold_count: number;
  blocked_count: number;
  total_inventory_value: number;
  booked_value: number;
};
