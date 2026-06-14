export type AgencyUser = {
  id: string;
  agency_id: string;
  name: string;
  email: string;
  role: "marketing_manager" | "marketing_executive";
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
  sender_role: "owner" | "marketing_manager" | "marketing_executive" | string;
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
  review_note: string;
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
