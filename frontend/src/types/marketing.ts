// MODIFIED: Marketing workspace foundation — unified marketing request, account, notification, and approval types for the live Ads module and admin assignment panel.
export type MarketingRole = "admin" | "agency" | "marketing_manager" | "marketing_employee" | "subscriber";

export type AgencyUser = {
  id: string;
  agency_id: string;
  name: string;
  email: string;
  role: "marketing_manager" | "marketing_executive" | string;
  status: string;
  created_at: string;
};

export type MarketingAddon = {
  id: string;
  enterprise_owner_id: string;
  addon_type: string;
  status: string;
  start_date: string;
  end_date: string | null;
  monthly_amount: number;
  currency: string;
  razorpay_payment_id: string | null;
};

export type MarketingAddonCatalogPlan = {
  addon_type: string;
  monthly_amount: number;
  term_days: number;
  features: string[];
};

export type MarketingAddonStatusResponse = {
  has_active_addon: boolean;
  addon: MarketingAddon | null;
  plans?: MarketingAddonCatalogPlan[];
};

export type MarketingOwnerSummary = {
  id: string;
  name: string;
  email: string;
  company: string;
  city: string;
};

export type Comment = {
  id: string;
  request_id: string;
  task_id: string | null;
  sender_id: string;
  sender_role: "owner" | "marketing_manager" | "marketing_executive" | "subscriber" | string;
  sender_name: string;
  message: string;
  created_at: string;
};

export type Approval = {
  id: string;
  request_id: string;
  task_id: string | null;
  approval_type: string;
  description: string;
  status: string;
  reviewed_by: string | null;
  reviewed_by_name: string;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type MarketingTask = {
  id: string;
  request_id: string;
  agency_id: string;
  assigned_to: string | null;
  assigned_by: string | null;
  assigned_to_name: string;
  assigned_by_name: string;
  title: string;
  description: string;
  task_type: string;
  due_date: string | null;
  status: string;
  deliverable_url: string | null;
  deliverable_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Campaign = {
  id: string;
  name: string;
  channel: string;
  status: string;
  spend: number;
  budget: number;
  leads: number;
  deals_created: number;
  assigned_to_name: string;
  deliverable_url: string | null;
  due_date: string | null;
};

export type MarketingRequestSummary = {
  id: string;
  request_code: string;
  channel: string;
  objective: string;
  project_name: string;
  status: string;
  addon_type: string;
  owner: MarketingOwnerSummary;
  assigned_manager: AgencyUser | null;
  task_count: number;
  completed_task_count: number;
  latest_comment: Comment | null;
  pending_owner_approvals: number;
  created_at: string;
  updated_at: string;
};

export type MarketingRequestDetail = MarketingRequestSummary & {
  addon_subscription: MarketingAddon;
  lead_target: number;
  launch_date: string | null;
  duration: string;
  monthly_spend: number;
  overspend_tolerance: string;
  reporting_frequency: string;
  cta: string;
  usp: string;
  notes: string;
  property_type: string;
  target_city: string;
  target_area: string;
  price_range: string;
  target_audience: string;
  primary_goal: string;
  tasks: MarketingTask[];
  comments: Comment[];
  approvals: Approval[];
};

export type MarketingMetrics = {
  active_requests: number;
  pending_approvals: number;
  in_progress_tasks: number;
  completed_this_month: number;
  unread_comments: number;
  active_addon_type: string;
  active_addon_renews_on: string | null;
};

export type LeadFunnelMetrics = {
  submitted: number;
  in_progress: number;
  review: number;
  completed: number;
};

export type MarketingNotification = {
  id: string;
  user_id: string;
  user_type: string;
  message: string;
  link: string;
  read: boolean;
  created_at: string;
};

export type MarketingActivityLogEntry = {
  id: string;
  request_id: string;
  actor_id: string;
  actor_role: string;
  message: string;
  detail: string;
  created_at: string;
};

export type MarketingWorkspaceAccess = {
  role: MarketingRole | string;
  subscription_plan: string;
  crm_plan: string;
  active_addon_type: string | null;
  active_addon_status: string;
  request_allowed: boolean;
  managed_marketing_allowed: boolean;
  allowed_addons: string[];
  upgrade_required: boolean;
  upgrade_message: string | null;
};

export type MarketingRequestCreatePayload = {
  channel: string;
  objective: string;
  project_name: string;
  property_type: string;
  target_city: string;
  target_area: string;
  price_range: string;
  target_audience: string;
  primary_goal: string;
  lead_target: number;
  launch_date: string | null;
  duration: string;
  monthly_spend: number;
  overspend_tolerance: string;
  reporting_frequency: string;
  cta: string;
  usp: string;
  notes: string;
};

export type MarketingAccount = {
  id: string;
  platform: string;
  account_name: string;
  external_account_id: string;
  status: string;
  allotted_to_owner_id: string | null;
  allotted_to_owner_name: string;
  allotted_to_owner_email: string;
  allotted_to_company: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type MarketingAccountCreatePayload = {
  platform: string;
  account_name: string;
  external_account_id: string;
  notes: string;
};

export type MarketingAccountAllotment = {
  id: string;
  account_id: string;
  account_name: string;
  platform: string;
  enterprise_owner_id: string;
  owner_name: string;
  owner_email: string;
  subscription_plan: string;
  addon_type: string;
  action: string;
  allotted_by_user_id: string | null;
  revoked_by_user_id: string | null;
  notes: string;
  created_at: string;
  revoked_at: string | null;
};

export type AdminMarketingRequestRow = {
  id: string;
  request_code: string;
  owner_id: string;
  owner_name: string;
  company: string;
  city: string;
  channel: string;
  objective: string;
  project_name: string;
  status: string;
  monthly_spend: number;
  created_at: string;
  updated_at: string;
};

export const MARKETING_PHASES = [
  "submitted",
  "agency_review",
  "agency_approved",
  "manager_review",
  "forwarded_to_employee",
  "in_progress",
  "completed",
] as const;
