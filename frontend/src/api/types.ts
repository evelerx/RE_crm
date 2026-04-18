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
  created_at: string;
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
