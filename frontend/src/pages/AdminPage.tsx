// MODIFIED: Phase 5 — Admin portal efficiency overhaul — Adds admin navigation, quick stats, user management, debounced search, pagination, and audited support actions.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import RevenueGraph from "../components/RevenueGraph";
import SubscriberDataTable from "../components/SubscriberDataTable";

// MODIFIED: Phase 2 — Admin revenue section mount — Adds subscription revenue analytics to the admin portal.

type AdminUserRow = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  whatsapp: string | null;
  company: string;
  city: string;
  areas_served: string;
  specialization: string;
  has_rera_id?: boolean;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  is_online: boolean;
  is_blacklisted: boolean;
  blacklist_reason: string;
  blacklisted_at: string | null;
  plan: "free" | "enterprise" | "builder";
  subscription_plan: string;
  subscription_cycle: string;
  subscription_seats: number;
  subscription_amount_inr: number;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  is_demo_account?: boolean;
  demo_plan?: string;
  enterprise_enabled_at: string | null;
  enterprise_owner_id: string;
  enterprise_member_role: string;
  employee_limit: number;
  llm_provider: string;
  llm_model: string;
  llm_allocated_at: string | null;
  has_llm_api_key: boolean;
  llm_access_scope: string;
  login_count: number;
  request_count: number;
  locked_until?: string | null;
  counts: { deals: number; contacts: number; activities: number };
  is_admin_account?: boolean;
};

type EnterpriseEmployeeRow = {
  id: string;
  email: string;
  full_name: string;
  company: string;
  role_label: string;
  created_at: string;
  is_blacklisted: boolean;
  blacklist_reason: string;
  blacklisted_at: string | null;
  counts: {
    deals: number;
    closed_deals: number;
    open_deals: number;
    lost_deals: number;
    contacts: number;
    activities: number;
  };
};

type EnterpriseDetail = {
  enterprise_owner_id: string;
  owner_email: string;
  company: string;
  llm_provider?: string;
  llm_model?: string;
  llm_allocated_at?: string | null;
  has_llm_api_key?: boolean;
  employee_limit: number;
  employee_count: number;
  counts: { deals: number; contacts: number; activities: number };
  employees: EnterpriseEmployeeRow[];
};

type OwnerPipelineStageCounts = {
  new_lead: number;
  qualified: number;
  active: number;
  closed: number;
  lost: number;
};

type OwnerDealRow = {
  id: string;
  title: string;
  asset_type: string;
  stage: string;
  city: string;
  area: string;
  typology: string;
  ticket_size: number | null;
  customer_budget: number | null;
  close_probability: number | null;
  last_activity_at: string | null;
  updated_at: string;
};

type OwnerContactRow = {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  tags: string;
  updated_at: string;
};

type OwnerWorkspace = {
  enterprise_owner_id: string;
  pipeline: {
    total: number;
    stage_counts: OwnerPipelineStageCounts;
  };
  deals: OwnerDealRow[];
  contacts: OwnerContactRow[];
};

type DemoRequestRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string;
  city: string;
  preferred_plan: string;
  team_size: number;
  message: string;
  requested_at: string;
};

type AuditRow = {
  id: string;
  actor_user_id: string;
  actor_email: string;
  target_user_id: string;
  target_email: string;
  enterprise_owner_id: string;
  enterprise_owner_email: string;
  kind: string;
  summary: string;
  detail: string;
  readable_summary: string;
  created_at: string;
};

type SupportChatRow = {
  id: string;
  enterprise_owner_id: string;
  sender_user_id: string | null;
  sender_role: string;
  sender_email: string;
  message: string;
  created_at: string;
};

type SecurityPosture = {
  jwt_secret_default: boolean;
  data_encryption_key_missing: boolean;
  admin_uses_plain_password: boolean;
  pbkdf2_rounds: number;
  pbkdf2_rounds_weak: boolean;
  login_max_attempts: number;
  login_lockout_minutes: number;
  locked_accounts: number;
  recommendations: string[];
};

type ComplianceReport = {
  generated_at: string;
  controls: {
    jwt_secret_configured: boolean;
    data_encryption_key_configured: boolean;
    admin_password_hashed: boolean;
    login_max_attempts: number;
    login_lockout_minutes: number;
    jwt_exp_days: number;
  };
  counts: {
    users_total: number;
    enterprise_owners: number;
    enterprise_members: number;
    ai_assigned_accounts: number;
    blacklisted_users: number;
    locked_users: number;
  };
  recent_security_events: { kind: string; summary: string; detail: string; created_at: string }[];
  recent_audit_events: { kind: string; summary: string; detail: string; created_at: string }[];
};

type RuntimeConfig = {
  env_file_path: string;
  frontend_origin: string;
  public_app_url?: string;
  openrouter_base_url: string;
  openrouter_management_api_key_configured: boolean;
  builder_sites_base_url: string;
  admin_email: string;
  jwt_secret_configured: boolean;
  admin_password_mode: string;
  pbkdf2_rounds: number;
  data_encryption_key_configured: boolean;
  login_max_attempts: number;
  login_lockout_minutes: number;
  jwt_exp_days: number;
};

type SubscriptionAnalytics = {
  grain: "day" | "week" | "month" | "year";
  timeline: { label: string; enterprise: number; builder: number; total: number }[];
  current_mix: { free: number; enterprise: number; builder: number };
  tracked_subscriptions: number;
  revenue_supported: boolean;
  profit_supported: boolean;
  note: string;
};

type FallbackEmployeeRow = EnterpriseEmployeeRow;

function fmtDt(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function pct(value: number, max: number) {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function formatRupees(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function demoDaysRemaining(expiresAt: string | null) {
  if (!expiresAt) return 0;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return 0;
  const diffMs = expires.getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

function demoPlanLabel(row: AdminUserRow) {
  if (row.demo_plan) return row.demo_plan;
  if (row.plan === "enterprise") return "enterprise";
  if (row.plan === "builder") return "builder";
  return "solo";
}

function fallbackEmployeesFromUsers(rows: AdminUserRow[], selectedEnterpriseId: string): FallbackEmployeeRow[] {
  if (!selectedEnterpriseId) return [];
  return rows
    .filter((row) => row.enterprise_owner_id === selectedEnterpriseId)
    .map((row) => ({
      id: row.id,
      email: row.email,
      full_name: "",
      company: "",
      role_label: row.enterprise_member_role || "employee",
      created_at: row.created_at,
      is_blacklisted: row.is_blacklisted,
      blacklist_reason: row.blacklist_reason,
      blacklisted_at: row.blacklisted_at,
      counts: {
        deals: row.counts.deals ?? 0,
        closed_deals: 0,
        open_deals: row.counts.deals ?? 0,
        lost_deals: 0,
        contacts: row.counts.contacts ?? 0,
        activities: row.counts.activities ?? 0
      }
    }));
}

const demoChatRows: SupportChatRow[] = [
  {
    id: "demo-chat-1",
    enterprise_owner_id: "demo-enterprise-owner",
    sender_user_id: null,
    sender_role: "admin",
    sender_email: "admin@northstonecrm.com",
    message: "Welcome to the enterprise workspace. Your team setup and AI access are ready for onboarding.",
    created_at: "2026-05-14T10:30:00Z"
  },
  {
    id: "demo-chat-2",
    enterprise_owner_id: "demo-enterprise-owner",
    sender_user_id: "demo-owner",
    sender_role: "enterprise_owner",
    sender_email: "owner@northstonecrm.com",
    message: "Thanks, we are reviewing team progress and assigning brokers today.",
    created_at: "2026-05-14T11:00:00Z"
  }
];

export default function AdminPage() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseDetail[]>([]);
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string>("");
  const [selectedEnterprise, setSelectedEnterprise] = useState<EnterpriseDetail | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<OwnerWorkspace | null>(null);
  const [demoRequests, setDemoRequests] = useState<DemoRequestRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditLimit, setAuditLimit] = useState(30);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditListExpanded, setAuditListExpanded] = useState(false);
  const [chatRows, setChatRows] = useState<SupportChatRow[]>([]);
  const [security, setSecurity] = useState<SecurityPosture | null>(null);
  const [compliance, setCompliance] = useState<ComplianceReport | null>(null);
  const [subscriptionAnalytics, setSubscriptionAnalytics] = useState<SubscriptionAnalytics | null>(null);
  const [subscriptionGrain, setSubscriptionGrain] = useState<"day" | "week" | "month" | "year">("month");
  const [securityEventWindow, setSecurityEventWindow] = useState<"1d" | "2d" | "7d" | "all" | "date">("2d");
  const [securityEventDate, setSecurityEventDate] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastKpiRefreshAt, setLastKpiRefreshAt] = useState<Date | null>(null);
  const [adminSearchInput, setAdminSearchInput] = useState("");
  const [adminSearch, setAdminSearch] = useState("");
  const [adminRoleFilter, setAdminRoleFilter] = useState("all");
  const [adminPlanFilter, setAdminPlanFilter] = useState("all");
  const [adminStatusFilter, setAdminStatusFilter] = useState("all");
  const [adminPageSize, setAdminPageSize] = useState(25);
  const [adminPageIndex, setAdminPageIndex] = useState(1);
  const [selectedAdminUserIds, setSelectedAdminUserIds] = useState<Record<string, boolean>>({});
  const [adminActionMsg, setAdminActionMsg] = useState<string | null>(null);

  const [resetEmail, setResetEmail] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  const [blEmail, setBlEmail] = useState("");
  const [blReason, setBlReason] = useState("");
  const [blOn, setBlOn] = useState(true);
  const [blBusy, setBlBusy] = useState(false);
  const [blMsg, setBlMsg] = useState<string | null>(null);

  const [planEmail, setPlanEmail] = useState("");
  const [planValue, setPlanValue] = useState<"free" | "enterprise" | "builder">("enterprise");
  const [planBusy, setPlanBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState<string | null>(null);
  const [demoForm, setDemoForm] = useState({
    email: "",
    password: "",
    full_name: "",
    company: "",
    city: "",
    demo_plan: "solo" as "solo" | "enterprise" | "builder",
    employee_limit: 5
  });
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);
  const [demoDeleteBusyId, setDemoDeleteBusyId] = useState<string | null>(null);
  const [unlockEmail, setUnlockEmail] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockMsg, setUnlockMsg] = useState<string | null>(null);

  const [limitEmail, setLimitEmail] = useState("");
  const [limitValue, setLimitValue] = useState(0);
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  const [llmEmail, setLlmEmail] = useState("");
  const [aiAssignmentExpanded, setAiAssignmentExpanded] = useState(false);
  const [aiAssignmentSearch, setAiAssignmentSearch] = useState("");
  const [llmEnabled, setLlmEnabled] = useState(true);
  const [llmModel, setLlmModel] = useState("openai/gpt-4o-mini");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmMsg, setLlmMsg] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatEnterpriseId, setChatEnterpriseId] = useState<string>("");
  const [expandedAuditIds, setExpandedAuditIds] = useState<Record<string, boolean>>({});
  const [configBusy, setConfigBusy] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState({
    frontend_origin: "",
    public_app_url: "",
    openrouter_base_url: "",
    openrouter_management_api_key: "",
    builder_sites_base_url: "",
    admin_email: "",
    jwt_secret: "",
    admin_password: "",
    data_encryption_key: "",
    pbkdf2_rounds: 120000,
    login_max_attempts: 5,
    login_lockout_minutes: 15,
    jwt_exp_days: 30,
    store_admin_password_as_hash: true
  });

  const showDemoPreview = false;
  const displayRows = rows;
  const displayEnterprises = enterprises;
  const displaySecurity = security;
  const displayCompliance = compliance;
  const displaySubscriptionAnalytics = subscriptionAnalytics;
  const displayAuditRows = auditRows;
  const activeDemoAccounts = rows.filter(
    (row) => row.subscription_plan === "demo" && !row.enterprise_owner_id
  );

  async function loadEnterpriseDetails(nextId: string, enterpriseRows?: EnterpriseDetail[]) {
    if (!nextId) {
      setSelectedEnterprise(null);
      setSelectedWorkspace(null);
      setChatRows([]);
      return;
    }
    const local = (enterpriseRows ?? enterprises).find((enterprise) => enterprise.enterprise_owner_id === nextId) ?? null;
    setSelectedEnterprise(local);
    try {
      const [detail, chat, workspace] = await Promise.all([
        api<EnterpriseDetail>(`/admin/enterprises/${nextId}`),
        api<SupportChatRow[]>(`/admin/support-chat/${nextId}`),
        api<OwnerWorkspace>(`/admin/enterprises/${nextId}/workspace`)
      ]);
      setEnterprises((prev) =>
        prev.map((enterprise) =>
          enterprise.enterprise_owner_id === detail.enterprise_owner_id ? detail : enterprise
        )
      );
      setSelectedEnterprise(detail);
      setSelectedWorkspace(workspace);
      setChatRows(chat);
    } catch (e) {
      setSelectedEnterprise(local);
      setSelectedWorkspace(null);
      setChatRows([]);
      throw e;
    }
  }

  async function loadAuditFeed(limit = auditLimit) {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const audits = await api<AuditRow[]>(`/admin/audit?limit=${limit}`);
      setAuditRows(audits);
      setExpandedAuditIds({});
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : "Failed to load recent audits");
    } finally {
      setAuditLoading(false);
    }
  }

  async function loadSubscriptionAnalytics(grain = subscriptionGrain) {
    try {
      const analytics = await api<SubscriptionAnalytics>(`/admin/subscription-analytics?grain=${grain}`);
      setSubscriptionAnalytics(analytics);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load subscription analytics");
    }
  }

  async function load(selectedId?: string) {
    setLoading(true);
    setError(null);
    try {
        const [users, enterpriseRows, securityPosture, complianceReport, runtime, subscriptionData, demoRows] = await Promise.all([
        api<AdminUserRow[]>("/admin/users"),
        api<EnterpriseDetail[]>("/admin/enterprises"),
        api<SecurityPosture>("/admin/security-posture"),
        api<ComplianceReport>("/admin/compliance-report"),
        api<RuntimeConfig>("/admin/runtime-config"),
        api<SubscriptionAnalytics>(`/admin/subscription-analytics?grain=${subscriptionGrain}`),
        api<DemoRequestRow[]>("/admin/demo-requests")
      ]);
      const adminMe = await api<{ is_admin: boolean; email: string }>("/admin/me");
      setRows(users);
      setEnterprises(enterpriseRows);
      setSecurity(securityPosture);
      setCompliance(complianceReport);
      setSubscriptionAnalytics(subscriptionData);
      setDemoRequests(demoRows);
      setRuntimeConfig(runtime);
      setLastKpiRefreshAt(new Date());
      setAdminEmail(adminMe.email || "");
      setConfigForm((prev) => ({
        ...prev,
        frontend_origin: runtime.frontend_origin || "",
        public_app_url: runtime.public_app_url || "",
        openrouter_base_url: runtime.openrouter_base_url || "",
        builder_sites_base_url: runtime.builder_sites_base_url || "https://northstonecrm.com/builders",
        admin_email: runtime.admin_email || "",
        pbkdf2_rounds: runtime.pbkdf2_rounds || 120000,
        login_max_attempts: runtime.login_max_attempts || 5,
        login_lockout_minutes: runtime.login_lockout_minutes || 15,
        jwt_exp_days: runtime.jwt_exp_days || 30
      }));

      const nextId =
        (selectedId && selectedId.trim()) ||
        (selectedEnterpriseId && selectedEnterpriseId.trim()) ||
        enterpriseRows[0]?.enterprise_owner_id ||
        "";
      setSelectedEnterpriseId(nextId);
      setChatEnterpriseId((prev) => (prev && prev.trim() ? prev : nextId));
      const picked = enterpriseRows.find((enterprise) => enterprise.enterprise_owner_id === nextId) ?? null;
      if (picked) {
        setLlmEmail((prev) => prev || picked.owner_email);
        setLimitEmail((prev) => prev || picked.owner_email);
      }
      await loadEnterpriseDetails(nextId, enterpriseRows);
      void loadAuditFeed(auditLimit);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError("Admin access only. Set ADMIN_EMAIL in backend/.env to your email.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load admin data");
      }
    } finally {
      setLoading(false);
    }
  }

  const selectedEnterpriseView =
        (selectedEnterprise && selectedEnterprise.enterprise_owner_id === selectedEnterpriseId
      ? selectedEnterprise
      : null) ??
    displayEnterprises.find((enterprise) => enterprise.enterprise_owner_id === selectedEnterpriseId) ??
    null;
  const selectedChatEnterpriseView =
    (selectedEnterprise && selectedEnterprise.enterprise_owner_id === chatEnterpriseId
      ? selectedEnterprise
      : null) ??
    displayEnterprises.find((enterprise) => enterprise.enterprise_owner_id === chatEnterpriseId) ??
    null;
  const selectedEnterpriseEmployees =
    (selectedEnterpriseView?.employees?.length ? selectedEnterpriseView.employees : []) ||
    [];
  const selectedEnterpriseEmployeesResolved =
    selectedEnterpriseEmployees.length > 0
      ? selectedEnterpriseEmployees
      : fallbackEmployeesFromUsers(displayRows, selectedEnterpriseId);
  const selectedPipeline =
    selectedWorkspace?.enterprise_owner_id === selectedEnterpriseId ? selectedWorkspace.pipeline : null;
  const selectedDeals =
    selectedWorkspace?.enterprise_owner_id === selectedEnterpriseId ? selectedWorkspace.deals : [];
  const selectedContacts =
    selectedWorkspace?.enterprise_owner_id === selectedEnterpriseId ? selectedWorkspace.contacts : [];
  const visibleAuditRows = auditListExpanded ? displayAuditRows : displayAuditRows.slice(0, 1);
  const hasEffectiveAiAccess = (row: AdminUserRow) =>
    row.has_llm_api_key || row.llm_access_scope === "inherited_enterprise";
  const describeAccountType = (row: AdminUserRow) =>
    row.is_admin_account
      ? "Admin"
      : row.enterprise_owner_id
        ? `Employee${row.enterprise_member_role ? ` · ${row.enterprise_member_role}` : ""}`
        : row.plan === "builder"
          ? "Builder owner"
          : row.plan === "enterprise"
            ? "Enterprise owner"
            : "Solo user";
  const aiAssignedRows = displayRows.filter((row) => hasEffectiveAiAccess(row));
  const aiUnassignedRows = displayRows.filter((row) => !hasEffectiveAiAccess(row));
  const ownerSelectableRows = displayRows.filter((row) => !row.is_admin_account && !row.enterprise_owner_id);
  const aiSelectableRows = displayRows.filter((row) => !row.is_demo_account);
  const filteredAiUnassignedRows = aiUnassignedRows.filter((row) => {
    const q = aiAssignmentSearch.trim().toLowerCase();
    if (!q) return true;
    return [
      row.full_name,
      row.email,
      row.company,
      row.city,
      row.plan,
      row.enterprise_member_role,
      describeAccountType(row)
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
  const complianceBars = displayCompliance
    ? [
        { label: "Enterprise owners", value: displayCompliance.counts.enterprise_owners, tone: "brand" as const },
        { label: "Enterprise members", value: displayCompliance.counts.enterprise_members, tone: "brand" as const },
        { label: "AI assigned", value: displayCompliance.counts.ai_assigned_accounts, tone: "success" as const },
        { label: "Blacklisted", value: displayCompliance.counts.blacklisted_users, tone: "warning" as const },
        { label: "Locked", value: displayCompliance.counts.locked_users, tone: "warning" as const }
      ]
    : [];
  const complianceBarMax = Math.max(1, ...complianceBars.map((item) => item.value));
  const securityBars = displaySecurity
    ? [
        { label: "PBKDF2 rounds", value: pct(displaySecurity.pbkdf2_rounds, 180000), display: displaySecurity.pbkdf2_rounds.toLocaleString(), tone: "brand" as const },
        { label: "Login max attempts", value: pct(displaySecurity.login_max_attempts, 10), display: String(displaySecurity.login_max_attempts), tone: "warning" as const },
        { label: "Lockout minutes", value: pct(displaySecurity.login_lockout_minutes, 30), display: `${displaySecurity.login_lockout_minutes}m`, tone: "success" as const },
        { label: "Locked accounts", value: pct(displaySecurity.locked_accounts, Math.max(1, displaySecurity.locked_accounts, 5)), display: String(displaySecurity.locked_accounts), tone: "warning" as const }
      ]
    : [];
  const subscriptionPoints = displaySubscriptionAnalytics?.timeline ?? [];
  const subscriptionMax = Math.max(
    1,
    ...subscriptionPoints.map((item) => item.total),
    displaySubscriptionAnalytics?.tracked_subscriptions ?? 1
  );
  const demoEnterpriseMonthlyPrice = 20000;
  const demoBuilderMonthlyPrice = 35000;
  const demoEstimatedMrr = showDemoPreview && displaySubscriptionAnalytics
    ? (displaySubscriptionAnalytics.current_mix.enterprise * demoEnterpriseMonthlyPrice) +
      (displaySubscriptionAnalytics.current_mix.builder * demoBuilderMonthlyPrice)
    : 0;
  const demoEstimatedArr = demoEstimatedMrr * 12;

  const filteredRecentSecurityEvents = (() => {
    const rows = displayCompliance?.recent_security_events ?? [];
    if (securityEventWindow === "all") return rows;

    const now = new Date();
    if (securityEventWindow === "date") {
      if (!securityEventDate) return rows;
      return rows.filter((item) => {
        const itemDate = new Date(item.created_at);
        if (Number.isNaN(itemDate.getTime())) return false;
        const yyyy = itemDate.getFullYear();
        const mm = `${itemDate.getMonth() + 1}`.padStart(2, "0");
        const dd = `${itemDate.getDate()}`.padStart(2, "0");
        return `${yyyy}-${mm}-${dd}` === securityEventDate;
      });
    }

    const days = securityEventWindow === "1d" ? 1 : securityEventWindow === "2d" ? 2 : 7;
    const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return rows.filter((item) => {
      const itemDate = new Date(item.created_at);
      if (Number.isNaN(itemDate.getTime())) return false;
      return itemDate >= threshold;
    });
  })();

  const activeSubscriptions = displayRows.filter((row) => !row.enterprise_owner_id && !row.is_blacklisted && row.subscription_plan && row.subscription_plan !== "demo");
  const estimatedMrr = activeSubscriptions.reduce((sum, row) => {
    const amount = Number(row.subscription_amount_inr || 0);
    if (amount > 0) {
      return sum + (row.subscription_cycle === "annual" || row.subscription_cycle === "yearly" ? amount / 12 : amount);
    }
    if (row.plan === "enterprise") return sum + 6999;
    if (row.plan === "builder") return sum + 11999;
    return sum + (row.subscription_plan === "solo" ? 1199 : 0);
  }, 0);
  const todayKey = new Date().toDateString();
  const newSignupsToday = displayRows.filter((row) => new Date(row.created_at).toDateString() === todayKey).length;
  const recentActivityRows = displayAuditRows.slice(0, 10);
  const kpiAgeSeconds = lastKpiRefreshAt ? Math.max(0, Math.round((Date.now() - lastKpiRefreshAt.getTime()) / 1000)) : 0;

  const filteredAdminUsers = useMemo(() => {
    const q = adminSearch.trim().toLowerCase();
    return displayRows.filter((row) => {
      const status = row.is_blacklisted ? "inactive" : "active";
      const role = row.is_admin_account ? "admin" : row.enterprise_owner_id ? "employee" : row.plan === "builder" ? "builder" : row.plan === "enterprise" ? "owner" : "main";
      const haystack = [row.id, row.full_name, row.email, row.company, row.city, row.plan, row.subscription_plan, role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (
        (!q || haystack.includes(q)) &&
        (adminRoleFilter === "all" || role === adminRoleFilter) &&
        (adminPlanFilter === "all" || row.plan === adminPlanFilter || row.subscription_plan === adminPlanFilter) &&
        (adminStatusFilter === "all" || status === adminStatusFilter)
      );
    });
  }, [adminPlanFilter, adminRoleFilter, adminSearch, adminStatusFilter, displayRows]);

  const adminTotalPages = Math.max(1, Math.ceil(filteredAdminUsers.length / adminPageSize));
  const adminVisibleUsers = filteredAdminUsers.slice((adminPageIndex - 1) * adminPageSize, adminPageIndex * adminPageSize);
  const selectedAdminUsers = displayRows.filter((row) => selectedAdminUserIds[row.id]);

  function exportAdminUsers(rowsToExport = filteredAdminUsers) {
    const header = ["id", "name", "email", "role", "plan", "status", "last_login"];
    const csv = [
      header.join(","),
      ...rowsToExport.map((row) =>
        [
          row.id,
          row.full_name || "",
          row.email,
          describeAccountType(row),
          row.subscription_plan || row.plan,
          row.is_blacklisted ? "inactive" : "active",
          row.last_login_at || "",
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "northstone-admin-users.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function bulkSetActive(active: boolean) {
    if (!selectedAdminUsers.length) return;
    setAdminActionMsg(null);
    for (const row of selectedAdminUsers) {
      await api<{ ok: boolean }>("/admin/blacklist", {
        method: "POST",
        body: JSON.stringify({ email: row.email, reason: active ? "" : "Bulk admin deactivation", blacklisted: !active }),
      });
    }
    setAdminActionMsg(active ? "Selected users activated." : "Selected users deactivated.");
    setSelectedAdminUserIds({});
    await load();
  }

  async function updateUserPlan(row: AdminUserRow, plan: "free" | "enterprise" | "builder") {
    setAdminActionMsg(null);
    await api<{ ok: boolean }>("/admin/set-plan", {
      method: "POST",
      body: JSON.stringify({ email: row.email, plan }),
    });
    setAdminActionMsg(`Updated ${row.email} to ${plan}.`);
    await load();
  }

  async function impersonateForSupport(row: AdminUserRow) {
    setAdminActionMsg(null);
    await api<{ ok: boolean }>(`/admin/users/${row.id}/impersonate`, { method: "POST" });
    setAdminActionMsg(`Support impersonation audit logged for ${row.email}.`);
    await loadAuditFeed(auditLimit);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadAuditFeed(auditLimit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditLimit]);

  useEffect(() => {
    void loadSubscriptionAnalytics(subscriptionGrain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionGrain]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAdminSearch(adminSearchInput);
      setAdminPageIndex(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [adminSearchInput]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Admin Portal</div>
          <div className="muted">Users, access, and enterprise oversight.</div>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => void load()} type="button">
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? (
        <div className="skeletonCard" style={{ padding: "20px" }}>
          {[90, 75, 85, 60, 80, 70].map((w, i) => (
            <div key={i} className="skeletonBar" style={{ width: `${w}%`, marginBottom: 14 }} />
          ))}
        </div>
      ) : null}

      <nav className="adminSidebarNav" aria-label="Admin portal sections">
        {[
          ["Dashboard", "admin-dashboard", "D"],
          ["Users", "admin-users", "U"],
          ["Subscriptions", "admin-subscriptions", "S"],
          ["Revenue", "admin-revenue", "R"],
          ["Security", "admin-security", "A"],
          ["CRM Settings", "admin-settings", "C"],
          ["Org & Demo", "admin-organization", "O"],
          ["AI Assign", "admin-ai-assignment", "I"],
          ["Support", "admin-support", "P"],
          ["Logs", "admin-logs", "L"],
        ].map(([label, href, shortcut]) => (
          <a key={href} href={`#${href}`} className="adminNavItem">
            <span>{label}</span>
            <kbd>{shortcut}</kbd>
          </a>
        ))}
      </nav>

      <section id="admin-dashboard" className="card premiumPanel">
        <div className="sectionHeader">
          <div>
            <div className="cardTitle">Dashboard home</div>
            <div className="muted">Clickable operations snapshot. Last updated: {kpiAgeSeconds}s ago.</div>
          </div>
          <button className="btn ghost" type="button" onClick={() => void load()}>Refresh KPIs</button>
        </div>
        <div className="statsGrid">
          <a className="statCard adminStatLink" href="#admin-users">
            <div className="statLabel">Total users</div>
            <div className="statValue">{displayRows.length}</div>
            <div className="statHint">Open user management</div>
          </a>
          <a className="statCard adminStatLink" href="#admin-subscriptions">
            <div className="statLabel">Active subscriptions</div>
            <div className="statValue">{activeSubscriptions.length}</div>
            <div className="statHint">Review subscriber health</div>
          </a>
          <a className="statCard adminStatLink" href="#admin-revenue">
            <div className="statLabel">Revenue today</div>
            <div className="statValue">{formatRupees(Math.round(estimatedMrr / 30))}</div>
            <div className="statHint">Estimated daily MRR run-rate</div>
          </a>
          <a className="statCard adminStatLink" href="#admin-support">
            <div className="statLabel">Open support tickets</div>
            <div className="statValue">{chatRows.length}</div>
            <div className="statHint">Open support messages</div>
          </a>
          <a className="statCard adminStatLink" href="#admin-users">
            <div className="statLabel">New signups today</div>
            <div className="statValue">{newSignupsToday}</div>
            <div className="statHint">Check onboarding</div>
          </a>
        </div>
        <div className="adminQuickOps" aria-label="Important admin actions">
          <a className="card adminQuickCard" href="#admin-organization">
            <span className="pill">Org access</span>
            <strong>Plans and 5-day demo accounts</strong>
            <span className="muted">Assign Enterprise, Builder, Free, or create temporary demo logins.</span>
          </a>
          <button
            className="card adminQuickCard"
            type="button"
            onClick={() => {
              setAiAssignmentExpanded(true);
              window.setTimeout(() => {
                document.getElementById("admin-ai-assignment")?.scrollIntoView({
                  behavior: "smooth",
                  block: "start"
                });
              }, 0);
            }}
          >
            <span className="pill">AI access</span>
            <strong>{aiAssignedRows.length} assigned / {aiUnassignedRows.length} unassigned</strong>
            <span className="muted">Open the unassigned account list and assign AI keys from one place.</span>
          </button>
          <a className="card adminQuickCard" href="#admin-subscriptions">
            <span className="pill">Subscribers</span>
            <strong>Revenue and subscriber health</strong>
            <span className="muted">Review active plans, renewals, payment state, and churn risk.</span>
          </a>
        </div>
        <div className="card adminActivityFeed">
          <div className="cardTitle">Recent activity</div>
          {recentActivityRows.length ? (
            <div className="list">
              {recentActivityRows.map((item) => (
                <a key={item.id} className="listItem adminActivityItem" href="#admin-logs">
                  <span>{item.readable_summary || item.summary || item.kind}</span>
                  <span className="muted">{fmtDt(item.created_at)}</span>
                </a>
              ))}
            </div>
          ) : (
            <div className="muted">No recent activity loaded yet.</div>
          )}
        </div>
      </section>

      <section id="admin-users" className="card premiumPanel">
        <div className="sectionHeader">
          <div>
            <div className="cardTitle">User management</div>
            <div className="muted">Search, filter, paginate, export, activate/deactivate, and audit support access.</div>
          </div>
          <button className="btn secondary" type="button" onClick={() => exportAdminUsers()}>
            Export users
          </button>
        </div>
        {adminActionMsg ? <div className="alert ok">{adminActionMsg}</div> : null}
        <div className="adminTableToolbar">
          <input value={adminSearchInput} onChange={(e) => setAdminSearchInput(e.target.value)} placeholder="Search name, email, company" />
          <select value={adminRoleFilter} onChange={(e) => { setAdminRoleFilter(e.target.value); setAdminPageIndex(1); }}>
            <option value="all">All roles</option>
            <option value="admin">Admin</option>
            <option value="main">Main</option>
            <option value="owner">Owner</option>
            <option value="builder">Builder</option>
            <option value="employee">Employee</option>
          </select>
          <select value={adminPlanFilter} onChange={(e) => { setAdminPlanFilter(e.target.value); setAdminPageIndex(1); }}>
            <option value="all">All plans</option>
            <option value="free">Free</option>
            <option value="solo">Solo</option>
            <option value="enterprise">Enterprise</option>
            <option value="builder">Builder</option>
            <option value="demo">Demo</option>
          </select>
          <select value={adminStatusFilter} onChange={(e) => { setAdminStatusFilter(e.target.value); setAdminPageIndex(1); }}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select value={adminPageSize} onChange={(e) => { setAdminPageSize(Number(e.target.value) || 25); setAdminPageIndex(1); }}>
            <option value={25}>25 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
          </select>
        </div>
        <div className="adminTableToolbar">
          <button className="btn secondary" type="button" disabled={!selectedAdminUsers.length} onClick={() => exportAdminUsers(selectedAdminUsers)}>
            Export selected
          </button>
          <button className="btn secondary" type="button" disabled={!selectedAdminUsers.length} onClick={() => void bulkSetActive(true)}>
            Activate selected
          </button>
          <button className="btn secondary" type="button" disabled={!selectedAdminUsers.length} onClick={() => void bulkSetActive(false)}>
            Deactivate selected
          </button>
          <a className="btn secondary" href={`mailto:${selectedAdminUsers.map((row) => row.email).join(",")}`}>
            Bulk email
          </a>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={adminVisibleUsers.length > 0 && adminVisibleUsers.every((row) => selectedAdminUserIds[row.id])}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedAdminUserIds((current) => {
                        const next = { ...current };
                        adminVisibleUsers.forEach((row) => {
                          next[row.id] = checked;
                        });
                        return next;
                      });
                    }}
                  />
                </th>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && adminVisibleUsers.length === 0 ? (
                <tr><td colSpan={9} className="muted">Loading user rows...</td></tr>
              ) : null}
              {adminVisibleUsers.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!selectedAdminUserIds[row.id]}
                      onChange={(e) => setSelectedAdminUserIds((current) => ({ ...current, [row.id]: e.target.checked }))}
                    />
                  </td>
                  <td>{row.id.slice(0, 8)}</td>
                  <td>{row.full_name || "-"}</td>
                  <td>{row.email}</td>
                  <td>{describeAccountType(row)}</td>
                  <td>
                    <select value={row.plan} onChange={(e) => void updateUserPlan(row, e.target.value as "free" | "enterprise" | "builder")} disabled={row.is_admin_account}>
                      <option value="free">Free</option>
                      <option value="enterprise">Enterprise</option>
                      <option value="builder">Builder</option>
                    </select>
                  </td>
                  <td><span className={`healthBadge ${row.is_blacklisted ? "healthRisk" : "healthPower"}`}>{row.is_blacklisted ? "Inactive" : "Active"}</span></td>
                  <td>{fmtDt(row.last_login_at)}</td>
                  <td>
                    <div className="row adminRowActions">
                      <button className="btn ghost" type="button" onClick={() => void impersonateForSupport(row)}>Impersonate</button>
                      <a className="btn ghost" href={`mailto:${row.email}`}>Email</a>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && adminVisibleUsers.length === 0 ? (
                <tr><td colSpan={9} className="muted">No users match these filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="adminPagination">
          <button className="btn secondary" type="button" disabled={adminPageIndex <= 1} onClick={() => setAdminPageIndex((page) => Math.max(1, page - 1))}>Previous</button>
          <span>Page {adminPageIndex} of {adminTotalPages} | {filteredAdminUsers.length} users</span>
          <button className="btn secondary" type="button" disabled={adminPageIndex >= adminTotalPages} onClick={() => setAdminPageIndex((page) => Math.min(adminTotalPages, page + 1))}>Next</button>
        </div>
      </section>

      <section id="admin-revenue">
        <RevenueGraph />
      </section>
      <section id="admin-subscriptions">
        <SubscriberDataTable />
      </section>
      {displaySecurity ? (
        <section id="admin-security" className="card premiumPanel adminAnchorTarget">
          <div className="cardTitle">Security posture</div>
          <div className="statsGrid">
            <div className="statCard">
              <div className="statLabel">JWT secret</div>
              <div className="statValue">{displaySecurity.jwt_secret_default ? "Risk" : "Strong"}</div>
              <div className="statHint">Default JWT secrets make session forgery far easier.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Data encryption</div>
              <div className="statValue">{displaySecurity.data_encryption_key_missing ? "Missing" : "Enabled"}</div>
              <div className="statHint">Sensitive profile fields and AI keys should stay encrypted at rest.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Admin password mode</div>
              <div className="statValue">{displaySecurity.admin_uses_plain_password ? "Plain" : "Hashed"}</div>
              <div className="statHint">Production should run on hashed admin credentials only.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">PBKDF2 rounds</div>
              <div className="statValue">{displaySecurity.pbkdf2_rounds.toLocaleString()}</div>
              <div className="statHint">{displaySecurity.pbkdf2_rounds_weak ? "Raise this further for stronger password hashing." : "Hashing rounds are in a healthier range."}</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Login lockout</div>
              <div className="statValue">{displaySecurity.login_max_attempts}/{displaySecurity.login_lockout_minutes}m</div>
              <div className="statHint">{displaySecurity.locked_accounts} account(s) currently locked after failed-login protection.</div>
            </div>
          </div>
          <div className="miniChartsGrid">
            <div className="miniChartCard">
              <div className="miniChartTitle">Security controls graph</div>
              <div className="miniChartList">
                {securityBars.map((item) => (
                  <div key={item.label} className="miniBarRow">
                    <div className="miniBarMeta">
                      <span>{item.label}</span>
                      <b>{item.display}</b>
                    </div>
                    <div className="miniBarTrack">
                      <div className={`miniBarFill ${item.tone}`} style={{ width: `${item.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {displaySecurity.recommendations.length ? (
            <div className="list">
              {displaySecurity.recommendations.map((item) => (
                <div key={item} className="listItem">{item}</div>
              ))}
            </div>
          ) : (
            <div className="alert ok">Core security configuration checks look healthy.</div>
          )}
        </section>
      ) : null}

      {runtimeConfig ? (
        <section id="admin-settings" className="card premiumPanel adminAnchorTarget">
          <div className="cardTitle">Admin runtime configuration</div>
          <div className="muted small">
            This writes directly to <b>{runtimeConfig.env_file_path}</b> so you can manage encryption, admin auth, and session controls from the panel.
          </div>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setConfigBusy(true);
              setConfigMsg(null);
              try {
                const payload = {
                  frontend_origin: configForm.frontend_origin,
                  public_app_url: configForm.public_app_url,
                  openrouter_base_url: configForm.openrouter_base_url,
                  builder_sites_base_url: configForm.builder_sites_base_url,
                  admin_email: configForm.admin_email,
                  pbkdf2_rounds: configForm.pbkdf2_rounds,
                  login_max_attempts: configForm.login_max_attempts,
                  login_lockout_minutes: configForm.login_lockout_minutes,
                  jwt_exp_days: configForm.jwt_exp_days,
                  store_admin_password_as_hash: configForm.store_admin_password_as_hash,
                  ...(configForm.jwt_secret.trim() ? { jwt_secret: configForm.jwt_secret } : {}),
                  ...(configForm.admin_password.trim() ? { admin_password: configForm.admin_password } : {}),
                  ...(configForm.data_encryption_key.trim() ? { data_encryption_key: configForm.data_encryption_key } : {}),
                  ...(configForm.openrouter_management_api_key.trim() ? { openrouter_management_api_key: configForm.openrouter_management_api_key } : {})
                };
                const updated = await api<RuntimeConfig>("/admin/runtime-config", {
                  method: "POST",
                  body: JSON.stringify(payload)
                });
                setRuntimeConfig(updated);
                setConfigForm((prev) => ({ ...prev, jwt_secret: "", admin_password: "", data_encryption_key: "", openrouter_management_api_key: "" }));
                setConfigMsg("Admin runtime configuration updated.");
                await load(selectedEnterpriseId);
              } catch (err) {
                setConfigMsg(err instanceof Error ? err.message : "Could not update runtime configuration");
              } finally {
                setConfigBusy(false);
              }
            }}
          >
            <div className="statsGrid">
              <div className="statCard">
                <div className="statLabel">Encryption</div>
                <div className="statValue">{runtimeConfig.data_encryption_key_configured ? "Enabled" : "Missing"}</div>
                <div className="statHint">Required before storing AI keys securely.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Admin password</div>
                <div className="statValue">{runtimeConfig.admin_password_mode}</div>
                <div className="statHint">Hashed mode is the safer production setup.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">JWT secret</div>
                <div className="statValue">{runtimeConfig.jwt_secret_configured ? "Configured" : "Missing"}</div>
                <div className="statHint">Controls token signing security.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Builder site AI</div>
                <div className="statValue">{runtimeConfig.openrouter_management_api_key_configured ? "Ready" : "Missing"}</div>
                <div className="statHint">Creates one $0.08 OpenRouter child key per builder website.</div>
              </div>
            </div>
            <div className="grid2">
              <label>
                Admin email
                <input value={configForm.admin_email} onChange={(e) => setConfigForm((prev) => ({ ...prev, admin_email: e.target.value }))} />
              </label>
              <label>
                Frontend origin
                <input value={configForm.frontend_origin} onChange={(e) => setConfigForm((prev) => ({ ...prev, frontend_origin: e.target.value }))} placeholder="http://localhost:5173" />
              </label>
            </div>
            <div className="grid2">
              <label>
                Public app URL
                <input value={configForm.public_app_url} onChange={(e) => setConfigForm((prev) => ({ ...prev, public_app_url: e.target.value }))} placeholder="https://app.northstonecrm.com" />
              </label>
              <label>
                Builder sites base URL
                <input value={configForm.builder_sites_base_url} onChange={(e) => setConfigForm((prev) => ({ ...prev, builder_sites_base_url: e.target.value }))} placeholder="https://northstonecrm.com/builders" />
              </label>
            </div>
            <div className="grid2">
              <label>
                OpenRouter base URL
                <input value={configForm.openrouter_base_url} onChange={(e) => setConfigForm((prev) => ({ ...prev, openrouter_base_url: e.target.value }))} />
              </label>
              <label>
                OpenRouter management API key
                <input
                  value={configForm.openrouter_management_api_key}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, openrouter_management_api_key: e.target.value }))}
                  placeholder={runtimeConfig.openrouter_management_api_key_configured ? "Paste only to rotate the management key" : "Paste OpenRouter management key"}
                  type="password"
                />
              </label>
            </div>
            <div className="grid2">
              <label>
                Data encryption key
                <input
                  value={configForm.data_encryption_key}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, data_encryption_key: e.target.value }))}
                  placeholder={runtimeConfig.data_encryption_key_configured ? "Enter a new key only if you want to rotate it" : "Paste a generated Fernet key"}
                  type="password"
                />
              </label>
            </div>
            <div className="grid2">
              <label>
                New JWT secret
                <input
                  value={configForm.jwt_secret}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, jwt_secret: e.target.value }))}
                  placeholder="Leave blank to keep current secret"
                  type="password"
                />
              </label>
              <label>
                New admin password
                <input
                  value={configForm.admin_password}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, admin_password: e.target.value }))}
                  placeholder="Leave blank to keep current password"
                  type="password"
                />
              </label>
            </div>
            <label>
              Password storage mode
              <select
                value={configForm.store_admin_password_as_hash ? "hashed" : "plain"}
                onChange={(e) => setConfigForm((prev) => ({ ...prev, store_admin_password_as_hash: e.target.value === "hashed" }))}
              >
                <option value="hashed">Store as hash</option>
                <option value="plain">Store as plain text</option>
              </select>
            </label>
            <div className="grid2">
              <label>
                PBKDF2 rounds
                <input
                  type="number"
                  min={60000}
                  value={configForm.pbkdf2_rounds}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, pbkdf2_rounds: Number(e.target.value) || 60000 }))}
                />
              </label>
              <label>
                JWT expiry days
                <input
                  type="number"
                  min={1}
                  value={configForm.jwt_exp_days}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, jwt_exp_days: Number(e.target.value) || 30 }))}
                />
              </label>
            </div>
            <div className="grid2">
              <label>
                Login max attempts
                <input
                  type="number"
                  min={1}
                  value={configForm.login_max_attempts}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, login_max_attempts: Number(e.target.value) || 5 }))}
                />
              </label>
              <label>
                Lockout minutes
                <input
                  type="number"
                  min={1}
                  value={configForm.login_lockout_minutes}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, login_lockout_minutes: Number(e.target.value) || 15 }))}
                />
              </label>
            </div>
            {configMsg ? <div className="alert ok">{configMsg}</div> : null}
            <button className="btn" type="submit" disabled={configBusy}>
              {configBusy ? "Saving..." : "Save admin configuration"}
            </button>
          </form>
        </section>
      ) : null}

      {displaySubscriptionAnalytics ? (
        <section id="admin-subscription-trend" className="card premiumPanel adminAnchorTarget">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div className="cardTitle">Subscription trend graph</div>
              <div className="muted small">{displaySubscriptionAnalytics.note}</div>
            </div>
            <label className="muted small">
              View by
              <select
                value={subscriptionGrain}
                onChange={(e) => setSubscriptionGrain((e.target.value as "day" | "week" | "month" | "year") || "month")}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </label>
          </div>
          <div className="statsGrid">
            <div className="statCard">
              <div className="statLabel">Tracked subscriptions</div>
              <div className="statValue">{displaySubscriptionAnalytics.tracked_subscriptions}</div>
              <div className="statHint">Enterprise and builder owner activations tracked in the current database.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Current free</div>
              <div className="statValue">{displaySubscriptionAnalytics.current_mix.free}</div>
              <div className="statHint">Owner accounts currently on the free plan.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Current enterprise</div>
              <div className="statValue">{displaySubscriptionAnalytics.current_mix.enterprise}</div>
              <div className="statHint">Owner accounts currently on enterprise.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Current builder</div>
              <div className="statValue">{displaySubscriptionAnalytics.current_mix.builder}</div>
              <div className="statHint">Owner accounts currently on builder.</div>
            </div>
          </div>
          <div className="miniChartsGrid">
            <div className="miniChartCard">
              <div className="miniChartTitle">Subscription sales over time</div>
              {subscriptionPoints.length === 0 ? (
                <div className="muted">No subscription activations have been recorded yet.</div>
              ) : (
                <div className="miniChartList">
                  {subscriptionPoints.map((point) => (
                    <div key={point.label} className="miniBarRow">
                      <div className="miniBarMeta">
                        <span>{point.label}</span>
                        <b>{point.total} total</b>
                      </div>
                      <div className="miniBarTrack">
                        <div className="miniBarFill brand" style={{ width: `${pct(point.total, subscriptionMax)}%` }} />
                      </div>
                      <div className="muted small">
                        Enterprise: {point.enterprise} | Builder: {point.builder}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {showDemoPreview ? (
              <div className="miniChartCard">
                <div className="miniChartTitle">Estimated billing preview</div>
                <div className="list">
                  <div className="listItem">
                    <div className="statLabel">Estimated MRR</div>
                    <div className="statValue">{formatRupees(demoEstimatedMrr)}</div>
                    <div className="statHint">Sample assumption only for presentation: Enterprise {formatRupees(demoEnterpriseMonthlyPrice)}/month, Builder {formatRupees(demoBuilderMonthlyPrice)}/month.</div>
                  </div>
                  <div className="listItem">
                    <div className="statLabel">Estimated ARR</div>
                    <div className="statValue">{formatRupees(demoEstimatedArr)}</div>
                    <div className="statHint">This preview helps validate the admin layout only. It is not connected to real billing or payment records.</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {!showDemoPreview && (!displaySubscriptionAnalytics.revenue_supported || !displaySubscriptionAnalytics.profit_supported) ? (
            <div className="muted small">
              Billing revenue and net profit reporting will appear here after real payment records, charge timestamps, refund events, and operating cost data are stored.
            </div>
          ) : null}
        </section>
      ) : null}

      <section id="admin-organization" className="card adminAnchorTarget">
        <div className="cardTitle">Reset user password</div>
        <form
          id="admin-ai-access-form"
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!resetEmail.trim() || resetPassword.length < 8) return;
            setResetBusy(true);
            setResetMsg(null);
            try {
              await api<{ reset: boolean; email: string }>("/admin/reset-password", {
                method: "POST",
                body: JSON.stringify({ email: resetEmail, new_password: resetPassword })
              });
              setResetMsg("Password reset saved.");
              setResetPassword("");
              await load();
            } catch (err) {
              setResetMsg(err instanceof Error ? err.message : "Reset failed");
            } finally {
              setResetBusy(false);
            }
          }}
        >
          <div className="grid2">
            <label>
              User email
              <input value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="user@example.com" list="admin-user-emails" />
            </label>
            <label>
              New password
              <input value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} type="password" placeholder="Minimum 8 characters" />
            </label>
          </div>
          {resetMsg ? <div className="alert ok">{resetMsg}</div> : null}
          <button className="btn" type="submit" disabled={resetBusy || !resetEmail.trim() || resetPassword.length < 8}>
            {resetBusy ? "Saving..." : "Reset password"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="cardTitle">Blacklist / Unblacklist user</div>
        <div className="muted">Blacklisted users keep data but cannot log in.</div>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!blEmail.trim()) return;
            setBlBusy(true);
            setBlMsg(null);
            try {
              await api<{ ok: boolean }>("/admin/blacklist", {
                method: "POST",
                body: JSON.stringify({ email: blEmail, reason: blReason, blacklisted: blOn })
              });
              setBlMsg(blOn ? "User blacklisted." : "User unblacklisted.");
              await load();
            } catch (err) {
              setBlMsg(err instanceof Error ? err.message : "Action failed");
            } finally {
              setBlBusy(false);
            }
          }}
        >
          <div className="grid2">
            <label>
              User email
              <input value={blEmail} onChange={(e) => setBlEmail(e.target.value)} placeholder="user@example.com" list="admin-user-emails" />
            </label>
            <label>
              Action
              <select value={blOn ? "blacklist" : "unblacklist"} onChange={(e) => setBlOn(e.target.value === "blacklist")}>
                <option value="blacklist">Blacklist</option>
                <option value="unblacklist">Unblacklist</option>
              </select>
            </label>
          </div>
          <label>
            Reason
            <input value={blReason} onChange={(e) => setBlReason(e.target.value)} placeholder="Optional reason shown to the user" />
          </label>
          {blMsg ? <div className="alert ok">{blMsg}</div> : null}
          <button className="btn" type="submit" disabled={blBusy || !blEmail.trim()}>
            {blBusy ? "Saving..." : "Apply"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="cardTitle">Unlock locked user</div>
        <div className="muted">Use this only after verifying the login issue was legitimate and the user should regain access.</div>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!unlockEmail.trim()) return;
            setUnlockBusy(true);
            setUnlockMsg(null);
            try {
              await api<{ ok: boolean }>("/admin/unlock-user", {
                method: "POST",
                body: JSON.stringify({ email: unlockEmail })
              });
              setUnlockMsg("User unlocked.");
              await load();
            } catch (err) {
              setUnlockMsg(err instanceof Error ? err.message : "Unlock failed");
            } finally {
              setUnlockBusy(false);
            }
          }}
        >
          <label>
            User email
            <input value={unlockEmail} onChange={(e) => setUnlockEmail(e.target.value)} placeholder="user@example.com" list="admin-user-emails" />
          </label>
          {unlockMsg ? <div className="alert ok">{unlockMsg}</div> : null}
          <button className="btn" type="submit" disabled={unlockBusy || !unlockEmail.trim()}>
            {unlockBusy ? "Unlocking..." : "Unlock account"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="cardTitle">Organization access</div>
        <div className="muted">Grant enterprise or builder mode to an owner account, or return it to a regular free account.</div>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!planEmail.trim()) return;
            setPlanBusy(true);
            setPlanMsg(null);
            try {
              await api<{ ok: boolean; email: string; plan: string }>("/admin/set-plan", {
                method: "POST",
                body: JSON.stringify({ email: planEmail, plan: planValue })
              });
              setPlanMsg(
                planValue === "enterprise"
                  ? "Enterprise enabled."
                  : planValue === "builder"
                    ? "Builder subscription enabled."
                    : "Organization mode removed."
              );
              await load();
            } catch (err) {
              setPlanMsg(err instanceof Error ? err.message : "Action failed");
            } finally {
              setPlanBusy(false);
            }
          }}
        >
          <div className="grid2">
              <label>
                User email
                <select value={planEmail} onChange={(e) => setPlanEmail(e.target.value)}>
                  <option value="">Select owner account</option>
                  {ownerSelectableRows.map((row) => (
                    <option key={row.id} value={row.email}>
                      {row.email}{row.full_name ? ` · ${row.full_name}` : ""}{row.company ? ` · ${row.company}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            <label>
              Plan
              <select
                value={planValue}
                onChange={(e) =>
                  setPlanValue(
                    e.target.value === "free" ? "free" : e.target.value === "builder" ? "builder" : "enterprise"
                  )
                }
              >
                <option value="enterprise">Enterprise</option>
                <option value="builder">Builder / Construction</option>
                <option value="free">Free</option>
              </select>
            </label>
          </div>
          {planMsg ? <div className="alert ok">{planMsg}</div> : null}
          <button className="btn" type="submit" disabled={planBusy || !planEmail.trim()}>
            {planBusy ? "Saving..." : "Apply"}
          </button>
        </form>

        <div className="card adminNestedCard">
          <div className="cardTitle">5-day demo access</div>
        <div className="muted">
          Create a real demo login inside organization access. Demo accounts stay live for 5 days, then the backend automatically removes that demo workspace and its data.
        </div>
        <form
          id="admin-ai-access-form"
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!demoForm.email.trim() || demoForm.password.trim().length < 8) return;
            setDemoBusy(true);
            setDemoMsg(null);
            try {
              await api<{ ok: boolean }>("/admin/demo-accounts", {
                method: "POST",
                body: JSON.stringify(demoForm)
              });
              setDemoMsg("5-day demo account created.");
              setDemoForm({
                email: "",
                password: "",
                full_name: "",
                company: "",
                city: "",
                demo_plan: "solo",
                employee_limit: 5
              });
              await load();
            } catch (err) {
              setDemoMsg(err instanceof Error ? err.message : "Could not create demo account");
            } finally {
              setDemoBusy(false);
            }
          }}
        >
          <div className="grid2">
            <label>
              Demo email
              <input
                value={demoForm.email}
                onChange={(e) => setDemoForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="demo-user@example.com"
              />
            </label>
            <label>
              Demo password
              <input
                value={demoForm.password}
                onChange={(e) => setDemoForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="Minimum 8 characters"
                type="password"
              />
            </label>
          </div>
          <div className="grid2">
            <label>
              Full name
              <input
                value={demoForm.full_name}
                onChange={(e) => setDemoForm((prev) => ({ ...prev, full_name: e.target.value }))}
                placeholder="Optional"
              />
            </label>
            <label>
              Demo type
              <select
                value={demoForm.demo_plan}
                onChange={(e) =>
                  setDemoForm((prev) => ({
                    ...prev,
                    demo_plan: (e.target.value as "solo" | "enterprise" | "builder") || "solo",
                    employee_limit:
                      e.target.value === "solo" ? 0 : Math.max(1, prev.employee_limit || 5)
                  }))
                }
              >
                <option value="solo">Solo</option>
                <option value="enterprise">Enterprise</option>
                <option value="builder">Builder</option>
              </select>
            </label>
          </div>
          <div className="grid2">
            <label>
              Company
              <input
                value={demoForm.company}
                onChange={(e) => setDemoForm((prev) => ({ ...prev, company: e.target.value }))}
                placeholder="Optional"
              />
            </label>
            <label>
              City
              <input
                value={demoForm.city}
                onChange={(e) => setDemoForm((prev) => ({ ...prev, city: e.target.value }))}
                placeholder="Optional"
              />
            </label>
          </div>
          {demoForm.demo_plan !== "solo" ? (
            <label>
              Employee limit
              <input
                value={demoForm.employee_limit}
                onChange={(e) =>
                  setDemoForm((prev) => ({ ...prev, employee_limit: Math.max(1, Number(e.target.value) || 1) }))
                }
                type="number"
                min={1}
              />
            </label>
          ) : null}
          {demoMsg ? <div className="alert ok">{demoMsg}</div> : null}
          <button className="btn" type="submit" disabled={demoBusy || !demoForm.email.trim() || demoForm.password.trim().length < 8}>
            {demoBusy ? "Creating..." : "Create 5-day demo account"}
          </button>
        </form>

        <div className="tableWrap adminTableOffset">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Demo type</th>
                <th>Name</th>
                <th>Company</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Days left</th>
                <th>Employee limit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activeDemoAccounts.map((row) => (
                <tr key={row.id}>
                  <td className="tdTitle">{row.email}</td>
                  <td>{demoPlanLabel(row)}</td>
                  <td>{row.full_name || "-"}</td>
                  <td>{row.company || "-"}</td>
                  <td>{fmtDt(row.subscription_started_at)}</td>
                  <td>{fmtDt(row.subscription_expires_at)}</td>
                  <td>{demoDaysRemaining(row.subscription_expires_at)}</td>
                  <td>{row.plan === "free" ? "-" : row.employee_limit}</td>
                  <td>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={async () => {
                        setDemoDeleteBusyId(row.id);
                        setDemoMsg(null);
                        try {
                          await api<{ ok: boolean }>(`/admin/demo-accounts/${row.id}`, { method: "DELETE" });
                          setDemoMsg(`Deleted demo account ${row.email}.`);
                          await load();
                        } catch (err) {
                          setDemoMsg(err instanceof Error ? err.message : "Could not delete demo account");
                        } finally {
                          setDemoDeleteBusyId(null);
                        }
                      }}
                      disabled={demoDeleteBusyId === row.id}
                    >
                      {demoDeleteBusyId === row.id ? "Deleting..." : "Delete now"}
                    </button>
                  </td>
                </tr>
              ))}
              {!activeDemoAccounts.length ? (
                <tr>
                  <td colSpan={9} className="muted">
                    No active 5-day demo accounts yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        </div>
      </section>

      <section className="card">
        <div className="cardTitle">Set organization employee limit</div>
        <div className="muted">This controls how many broker / CP / employee IDs an enterprise or builder owner can create.</div>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!limitEmail.trim()) return;
            setLimitBusy(true);
            setLimitMsg(null);
            try {
              await api<{ ok: boolean; email: string; employee_limit: number }>("/admin/set-employee-limit", {
                method: "POST",
                body: JSON.stringify({ email: limitEmail, employee_limit: limitValue })
              });
              setLimitMsg("Employee limit updated.");
              await load();
            } catch (err) {
              setLimitMsg(err instanceof Error ? err.message : "Could not update limit");
            } finally {
              setLimitBusy(false);
            }
          }}
        >
          <div className="grid2">
              <label>
                Organization owner email
                <select value={limitEmail} onChange={(e) => setLimitEmail(e.target.value)}>
                  <option value="">Select organization owner</option>
                  {ownerSelectableRows
                    .filter((row) => row.plan === "enterprise" || row.plan === "builder")
                    .map((row) => (
                      <option key={row.id} value={row.email}>
                        {row.email}{row.company ? ` · ${row.company}` : ""} · {row.plan === "builder" ? "Builder" : "Enterprise"}
                      </option>
                    ))}
                </select>
              </label>
            <label>
              Employee limit
              <input value={limitValue} onChange={(e) => setLimitValue(Number(e.target.value) || 0)} type="number" min={0} />
            </label>
          </div>
          {limitMsg ? <div className="alert ok">{limitMsg}</div> : null}
          <button className="btn" type="submit" disabled={limitBusy || !limitEmail.trim()}>
            {limitBusy ? "Saving..." : "Save limit"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="cardTitle">Allocate AI key</div>
        <div className="muted">Assign one API key to a solo user, to yourself as admin, or to an enterprise / builder owner. Team underlings inherit the owner allocation automatically.</div>
        <form
          id="admin-ai-access-form"
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!llmEmail.trim()) return;
            setLlmBusy(true);
            setLlmMsg(null);
            try {
              await api<{ ok: boolean }>("/admin/set-llm-access", {
                method: "POST",
                body: JSON.stringify({
                  email: llmEmail,
                  provider: "openrouter",
                  api_key: llmApiKey,
                  model: llmModel,
                  enabled: llmEnabled
                })
              });
              setLlmMsg(llmEnabled ? "AI access updated." : "AI access removed.");
              if (llmEnabled) setLlmApiKey("");
              await load();
            } catch (err) {
              setLlmMsg(err instanceof Error ? err.message : "Could not update AI access");
            } finally {
              setLlmBusy(false);
            }
          }}
        >
          <div className="grid2">
            <label>
              User email
              <select value={llmEmail} onChange={(e) => setLlmEmail(e.target.value)}>
                <option value="">Select account for AI access</option>
                {aiSelectableRows.map((row) => (
                  <option key={row.id} value={row.email}>
                    {row.email} · {describeAccountType(row)}{row.company ? ` · ${row.company}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Action
              <select value={llmEnabled ? "enable" : "disable"} onChange={(e) => setLlmEnabled(e.target.value === "enable")}>
                <option value="enable">Enable / Replace</option>
                <option value="disable">Remove</option>
              </select>
            </label>
          </div>
          <div className="grid2">
            <label>
              Model
              <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="openai/gpt-4o-mini" />
            </label>
            <label>
              API key
              <input
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                placeholder={llmEnabled ? "sk-or-..." : "Not needed when removing access"}
                type="password"
              />
            </label>
          </div>
          <div className="row">
            <button className="btn ghost" type="button" onClick={() => setLlmEmail(adminEmail)} disabled={!adminEmail}>
              Use my admin account
            </button>
            {selectedEnterpriseView ? (
              <button className="btn ghost" type="button" onClick={() => setLlmEmail(selectedEnterpriseView.owner_email)}>
                Use selected enterprise owner
              </button>
            ) : null}
          </div>
          <div className="muted small">Do not assign keys to employee IDs directly. Give the key to the enterprise or builder owner account and their whole team will inherit it.</div>
          {llmMsg ? <div className="alert ok">{llmMsg}</div> : null}
          <button className="btn" type="submit" disabled={llmBusy || !llmEmail.trim() || (llmEnabled && !llmApiKey.trim())}>
            {llmBusy ? "Saving..." : llmEnabled ? "Save AI access" : "Remove AI access"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="cardTitle">Enterprise subscriptions</div>
        <div className="grid2">
          <label>
            Select enterprise
            <select
              value={selectedEnterpriseId}
              onChange={async (e) => {
                const nextId = e.target.value;
                setSelectedEnterpriseId(nextId);
                const picked = displayEnterprises.find((enterprise) => enterprise.enterprise_owner_id === nextId) ?? null;
                if (picked) {
                  setSelectedEnterprise(picked);
                  setLlmEmail(picked.owner_email);
                  setLimitEmail(picked.owner_email);
                }
                if (!showDemoPreview) {
                  try {
                    await loadEnterpriseDetails(nextId);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to load enterprise details");
                  }
                }
              }}
            >
              {displayEnterprises.map((enterprise) => (
                <option key={enterprise.enterprise_owner_id} value={enterprise.enterprise_owner_id}>
                  {enterprise.owner_email}
                </option>
              ))}
              {displayEnterprises.length === 0 ? <option value="">No enterprise owners yet</option> : null}
            </select>
          </label>
          {selectedEnterpriseView ? (
            <div className="card">
              <div className="cardTitle">Selected enterprise</div>
              <div className="mini">
                <div>
                  <b>Owner:</b> {selectedEnterpriseView.owner_email}
                </div>
                <div>
                  <b>Company:</b> {selectedEnterpriseView.company || "N/A"}
                </div>
                <div>
                  <b>Employee usage:</b> {selectedEnterpriseView.employee_count} / {selectedEnterpriseView.employee_limit}
                </div>
                <div>
                  <b>Combined deals:</b> {selectedEnterpriseView.counts.deals}
                </div>
                <div>
                  <b>Combined contacts:</b> {selectedEnterpriseView.counts.contacts}
                </div>
                <div>
                  <b>Combined activities:</b> {selectedEnterpriseView.counts.activities}
                </div>
                <div>
                  <b>Employees visible:</b> {selectedEnterpriseEmployeesResolved.length}
                </div>
                <div>
                  <b>AI access:</b> {selectedEnterpriseView.has_llm_api_key ? "Allocated" : "Not allocated"}
                </div>
                <div>
                  <b>AI model:</b> {selectedEnterpriseView.llm_model || "-"}
                </div>
                <div>
                  <b>AI assigned at:</b> {fmtDt(selectedEnterpriseView.llm_allocated_at ?? null)}
                </div>
                {showDemoPreview ? (
                  <div className="alert ok" style={{ marginTop: 10 }}>Demo enterprise preview only. Live enterprise actions will appear here once real owner accounts are created.</div>
                ) : (
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="btn ghost" type="button" onClick={() => setLlmEmail(selectedEnterpriseView.owner_email)}>
                      Use for AI key form
                    </button>
                    <button className="btn ghost" type="button" onClick={() => setLimitEmail(selectedEnterpriseView.owner_email)}>
                      Use for limit form
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={async () => {
                        try {
                          const repaired = await api<EnterpriseDetail>(`/admin/repair-enterprise-sync/${selectedEnterpriseView.enterprise_owner_id}`, {
                            method: "POST"
                          });
                          setSelectedEnterprise(repaired);
                          setEnterprises((prev) =>
                            prev.map((enterprise) =>
                              enterprise.enterprise_owner_id === repaired.enterprise_owner_id ? repaired : enterprise
                            )
                          );
                          await loadEnterpriseDetails(selectedEnterpriseView.enterprise_owner_id);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Failed to repair enterprise sync");
                        }
                      }}
                    >
                      Repair employee sync
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="muted">Choose an enterprise owner to inspect employee-level data.</div>
          )}
        </div>

        <div className="muted small">
          Admin can inspect brokers, CPs, and employee IDs under the selected enterprise below.
        </div>

        {selectedPipeline ? (
          <>
            <div className="statsGrid">
              <div className="statCard">
                <div className="statLabel">Pipeline total</div>
                <div className="statValue">{selectedPipeline.total}</div>
                <div className="statHint">All live deals currently visible for this subscription owner.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Demo requested</div>
                <div className="statValue">{demoRequests.length}</div>
                <div className="statHint">People who filled the landing-page demo form and can be contacted directly.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">New lead</div>
                <div className="statValue">{selectedPipeline.stage_counts.new_lead}</div>
                <div className="statHint">Fresh user client records now visible under this owner workspace.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Qualified</div>
                <div className="statValue">{selectedPipeline.stage_counts.qualified}</div>
                <div className="statHint">Client records that have moved beyond basic entry.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Active</div>
                <div className="statValue">{selectedPipeline.stage_counts.active}</div>
                <div className="statHint">Ongoing visits, follow-ups, or commercial progress under this owner.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Closed</div>
                <div className="statValue">{selectedPipeline.stage_counts.closed}</div>
                <div className="statHint">Converted deals already closed by this owner organization.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Lost</div>
                <div className="statValue">{selectedPipeline.stage_counts.lost}</div>
                <div className="statHint">Lost deals that still matter for admin oversight and coaching.</div>
              </div>
            </div>

            <div className="tableWrap" style={{ marginTop: 16 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Demo requester</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Company</th>
                    <th>City</th>
                    <th>Interested plan</th>
                    <th>Team size</th>
                    <th>Message</th>
                    <th>Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {demoRequests.map((request) => (
                    <tr key={request.id}>
                      <td className="tdTitle">{request.full_name || "-"}</td>
                      <td>{request.email || "-"}</td>
                      <td>{request.phone || "-"}</td>
                      <td>{request.company_name || "-"}</td>
                      <td>{request.city || "-"}</td>
                      <td>{request.preferred_plan || "-"}</td>
                      <td>{request.team_size || "-"}</td>
                      <td>{request.message || "-"}</td>
                      <td>{fmtDt(request.requested_at)}</td>
                    </tr>
                  ))}
                  {!demoRequests.length ? (
                    <tr>
                      <td colSpan={9} className="muted">
                        No landing-page demo requests have been captured yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="tableWrap" style={{ marginTop: 16 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Deal</th>
                    <th>Stage</th>
                    <th>Type</th>
                    <th>Location</th>
                    <th>Typology</th>
                    <th>Ticket size</th>
                    <th>Client budget</th>
                    <th>Close %</th>
                    <th>Last activity</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDeals.map((deal) => (
                    <tr key={deal.id}>
                      <td className="tdTitle">{deal.title}</td>
                      <td>{deal.stage || "-"}</td>
                      <td>{deal.asset_type || "-"}</td>
                      <td>{[deal.area, deal.city].filter(Boolean).join(", ") || "-"}</td>
                      <td>{deal.typology || "-"}</td>
                      <td>{deal.ticket_size != null ? formatRupees(deal.ticket_size) : "-"}</td>
                      <td>{deal.customer_budget != null ? formatRupees(deal.customer_budget) : "-"}</td>
                      <td>{deal.close_probability != null ? `${deal.close_probability}%` : "-"}</td>
                      <td>{fmtDt(deal.last_activity_at)}</td>
                      <td>{fmtDt(deal.updated_at)}</td>
                    </tr>
                  ))}
                  {!selectedDeals.length ? (
                    <tr>
                      <td colSpan={10} className="muted">
                        No deal records are attached to this subscription owner yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="tableWrap" style={{ marginTop: 16 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Role</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Tags</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedContacts.map((contact) => (
                    <tr key={contact.id}>
                      <td className="tdTitle">{contact.name}</td>
                      <td>{contact.role || "-"}</td>
                      <td>{contact.phone || "-"}</td>
                      <td>{contact.email || "-"}</td>
                      <td>{contact.tags || "-"}</td>
                      <td>{fmtDt(contact.updated_at)}</td>
                    </tr>
                  ))}
                  {!selectedContacts.length ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        No contact records are attached to this subscription owner yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Email</th>
                <th>Company</th>
                <th>Role</th>
                <th>Status</th>
                <th>Deals</th>
                <th>Closed</th>
                <th>Open</th>
                <th>Lost</th>
                <th>Contacts</th>
                <th>Activities</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {selectedEnterpriseEmployeesResolved.map((employee) => (
                <tr key={employee.id}>
                  <td className="tdTitle">{employee.full_name || "-"}</td>
                  <td>{employee.email}</td>
                  <td>{employee.company || selectedEnterpriseView?.company || "-"}</td>
                  <td>{employee.role_label}</td>
                  <td>{employee.is_blacklisted ? `Blacklisted${employee.blacklist_reason ? `: ${employee.blacklist_reason}` : ""}` : "Active"}</td>
                  <td>{employee.counts.deals}</td>
                  <td>{employee.counts.closed_deals ?? 0}</td>
                  <td>{employee.counts.open_deals ?? 0}</td>
                  <td>{employee.counts.lost_deals ?? 0}</td>
                  <td>{employee.counts.contacts}</td>
                  <td>{employee.counts.activities}</td>
                  <td>{fmtDt(employee.created_at)}</td>
                </tr>
              ))}
              {!selectedEnterpriseEmployeesResolved.length && !loading ? (
                <tr>
                  <td colSpan={12} className="muted">
                    No employees under this enterprise yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section id="admin-support" className="card adminAnchorTarget">
        <div className="cardTitle">Admin conversation with selected enterprise</div>
        <div className="grid2">
          <label>
            Private conversation with
            <select
              value={chatEnterpriseId}
              onChange={async (e) => {
                const nextId = e.target.value;
                setChatEnterpriseId(nextId);
                if (nextId) setSelectedEnterpriseId(nextId);
                try {
                  if (!showDemoPreview) {
                    await loadEnterpriseDetails(nextId);
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to load private conversation");
                }
              }}
            >
              {displayEnterprises.map((enterprise) => (
                <option key={enterprise.enterprise_owner_id} value={enterprise.enterprise_owner_id}>
                  {enterprise.owner_email}
                </option>
              ))}
              {displayEnterprises.length === 0 ? <option value="">No enterprise owners yet</option> : null}
            </select>
          </label>
          {selectedChatEnterpriseView ? (
            <div className="card">
              <div className="cardTitle">Private thread target</div>
              <div className="mini">
                <div>
                  <b>Owner:</b> {selectedChatEnterpriseView.owner_email}
                </div>
                <div>
                  <b>Company:</b> {selectedChatEnterpriseView.company || "N/A"}
                </div>
                <div>
                  <b>Employee usage:</b> {selectedChatEnterpriseView.employee_count} / {selectedChatEnterpriseView.employee_limit}
                </div>
              </div>
            </div>
          ) : (
            <div className="muted">Choose an enterprise owner to start a private one-to-one conversation.</div>
          )}
        </div>
        {!selectedChatEnterpriseView ? (
          <div className="muted">Select an enterprise first to view or send support messages.</div>
        ) : (
          <>
            <div className="muted small">
              Messages here are only between admin and {selectedChatEnterpriseView.owner_email}.
            </div>
            <div className="chatList">
              {(showDemoPreview ? demoChatRows : chatRows).length === 0 ? <div className="muted">No conversation yet.</div> : null}
              {(showDemoPreview ? demoChatRows : chatRows).map((item) => (
                <div key={item.id} className={`chatBubble ${item.sender_role === "admin" ? "chatBubbleAdmin" : ""}`}>
                  <div className="chatMeta">
                    <b>{item.sender_role === "admin" ? "Admin" : "Enterprise owner"}</b>
                    <span>{item.sender_email || "-"}</span>
                    <span>{fmtDt(item.created_at)}</span>
                  </div>
                  <div>{item.message}</div>
                </div>
              ))}
            </div>
            {!showDemoPreview ? (
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!selectedChatEnterpriseView || !chatDraft.trim()) return;
                setChatBusy(true);
                try {
                  await api<SupportChatRow>(`/admin/support-chat/${selectedChatEnterpriseView.enterprise_owner_id}`, {
                    method: "POST",
                    body: JSON.stringify({ message: chatDraft })
                  });
                  setChatDraft("");
                  await loadEnterpriseDetails(selectedChatEnterpriseView.enterprise_owner_id);
                  await load(selectedChatEnterpriseView.enterprise_owner_id);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not send message");
                } finally {
                  setChatBusy(false);
                }
              }}
            >
              <label>
                Reply
                <textarea className="textarea" value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder="Reply to this enterprise owner here..." />
              </label>
              <button className="btn" type="submit" disabled={chatBusy || !chatDraft.trim()}>
                {chatBusy ? "Sending..." : "Send message"}
              </button>
            </form>
            ) : (
              <div className="muted small">Demo conversation preview only. Live admin-to-enterprise messaging appears here once real enterprise owners are active.</div>
            )}
          </>
        )}
      </section>

      <section id="admin-logs" className="card adminAnchorTarget">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div className="cardTitle">Recent audit feed</div>
          <div className="row">
            <label className="muted small">
              Show
              <select value={auditLimit} onChange={(e) => setAuditLimit(Number(e.target.value) || 30)}>
                <option value={10}>10 logs</option>
                <option value={30}>30 logs</option>
                <option value={50}>50 logs</option>
                <option value={100}>100 logs</option>
              </select>
            </label>
            <button className="btn ghost" type="button" onClick={() => void loadAuditFeed(auditLimit)} disabled={auditLoading}>
              {auditLoading ? "Loading..." : "Reload logs"}
            </button>
            {displayAuditRows.length > 1 ? (
              <button className="btn ghost" type="button" onClick={() => setAuditListExpanded((value) => !value)}>
                {auditListExpanded ? "Show less" : `Show all ${displayAuditRows.length}`}
              </button>
            ) : null}
          </div>
        </div>
        {auditError ? <div className="alert">{auditError}</div> : null}
        {auditLoading && displayAuditRows.length === 0 ? (
          <div className="muted">Loading recent audit logs...</div>
        ) : !auditLoading && displayAuditRows.length === 0 ? (
          <div className="muted">No tracked admin or enterprise actions yet.</div>
        ) : (
          <div className="list">
            {visibleAuditRows.map((item) => (
              <div key={item.id} className="listItem auditItem">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div className="grow">
                    <div><b>{item.readable_summary || item.summary}</b></div>
                    <div className="muted small">
                      {item.kind}
                      {item.target_email ? ` | target: ${item.target_email}` : ""}
                      {item.enterprise_owner_email ? ` | enterprise: ${item.enterprise_owner_email}` : ""}
                    </div>
                    {expandedAuditIds[item.id] ? (
                      <div className="auditDetails">
                        {item.detail ? <div className="muted small">{item.detail}</div> : <div className="muted small">No extra detail recorded for this event.</div>}
                      </div>
                    ) : null}
                  </div>
                  <div className="row">
                    <div className="muted small">{fmtDt(item.created_at)}</div>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() =>
                        setExpandedAuditIds((prev) => ({
                          ...prev,
                          [item.id]: !prev[item.id]
                        }))
                      }
                    >
                      {expandedAuditIds[item.id] ? "Collapse" : "Expand"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {displayCompliance ? (
        <section id="admin-ai-assignment" className="card premiumPanel adminAnchorTarget">
          <div className="cardTitle">Compliance evidence</div>
          <div className="statsGrid">
            <div className="statCard">
              <div className="statLabel">Users</div>
              <div className="statValue">{displayCompliance.counts.users_total}</div>
              <div className="statHint">{displayCompliance.counts.enterprise_owners} enterprise owners, {displayCompliance.counts.enterprise_members} enterprise members.</div>
            </div>
              <div className="statCard">
                <div className="statLabel">Protected AI</div>
                <div className="statValue">{displayCompliance.counts.ai_assigned_accounts}</div>
                <div className="statHint">{aiAssignedRows.length} assigned, {aiUnassignedRows.length} unassigned.</div>
                <button
                  className="btn ghost adminButtonOffset"
                  type="button"
                  onClick={() => setAiAssignmentExpanded((prev) => !prev)}
                >
                  {aiAssignmentExpanded ? "Hide AI assignment list" : "Show AI assignment list"}
                </button>
              </div>
            <div className="statCard">
              <div className="statLabel">Restricted</div>
              <div className="statValue">{displayCompliance.counts.blacklisted_users + displayCompliance.counts.locked_users}</div>
              <div className="statHint">{displayCompliance.counts.blacklisted_users} blacklisted, {displayCompliance.counts.locked_users} temporarily locked.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Session lifetime</div>
              <div className="statValue">{displayCompliance.controls.jwt_exp_days}d</div>
              <div className="statHint">Token expiry window currently configured.</div>
            </div>
          </div>
            <div className="miniChartsGrid">
              <div className="miniChartCard">
                <div className="miniChartTitle">Account mix graph</div>
                <div className="miniChartList">
                  {complianceBars.map((item) => (
                  <div key={item.label} className="miniBarRow">
                    <div className="miniBarMeta">
                      <span>{item.label}</span>
                      <b>{item.value}</b>
                    </div>
                    <div className="miniBarTrack">
                      <div className={`miniBarFill ${item.tone}`} style={{ width: `${pct(item.value, complianceBarMax)}%` }} />
                    </div>
                  </div>
                  ))}
                </div>
              </div>
            </div>
            {aiAssignmentExpanded ? (
              <div className="card adminNestedCard">
                <div className="cardTitle">AI assignment dropdown</div>
                <div className="muted">
                  Only accounts without active AI access are shown here. Click any row to load that account into the AI allocation form below.
                </div>
                <div className="row adminAiSearchRow">
                  <input
                    value={aiAssignmentSearch}
                    onChange={(e) => setAiAssignmentSearch(e.target.value)}
                    placeholder="Search unassigned accounts by name, email, company, city, or type"
                    className="adminAiSearchInput"
                  />
                  <div className="muted small">
                    {filteredAiUnassignedRows.length} of {aiUnassignedRows.length} unassigned accounts
                  </div>
                </div>
                <div className="tableWrap adminTableOffset">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Account type</th>
                        <th>Company</th>
                        <th>City</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAiUnassignedRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="muted">
                            No unassigned accounts match this search.
                          </td>
                        </tr>
                      ) : (
                        filteredAiUnassignedRows.map((row) => (
                          <tr key={row.id}>
                            <td>{row.full_name || "-"}</td>
                            <td>{row.email}</td>
                            <td>{describeAccountType(row)}</td>
                            <td>{row.company || "-"}</td>
                            <td>{row.city || "-"}</td>
                            <td>
                              <button
                                className="btn ghost"
                                type="button"
                                onClick={() => {
                                  setLlmEmail(row.email);
                                  setLlmEnabled(true);
                                  document.getElementById("admin-ai-access-form")?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "center"
                                  });
                                }}
                              >
                                Use for AI key form
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            <div className="muted small">Generated {fmtDt(displayCompliance.generated_at)}</div>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
            <div className="cardTitle" style={{ fontSize: 16 }}>Recent security events</div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <label className="muted small">
                Show
                <select value={securityEventWindow} onChange={(e) => setSecurityEventWindow((e.target.value as "1d" | "2d" | "7d" | "all" | "date") || "2d")}>
                  <option value="1d">Last 1 day</option>
                  <option value="2d">Last 2 days</option>
                  <option value="7d">Last 7 days</option>
                  <option value="all">All dates</option>
                  <option value="date">Specific date</option>
                </select>
              </label>
              {securityEventWindow === "date" ? (
                <label className="muted small">
                  Date
                  <input
                    type="date"
                    value={securityEventDate}
                    onChange={(e) => setSecurityEventDate(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </div>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Recent security event</th>
                  <th>Detail</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecentSecurityEvents.map((item, idx) => (
                  <tr key={`${item.kind}-${item.created_at}-${idx}`}>
                    <td className="tdTitle">{item.summary}</td>
                    <td
                      title={item.detail || "-"}
                      style={{
                        maxWidth: 420,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                      }}
                    >
                      {item.detail || "-"}
                    </td>
                    <td>{fmtDt(item.created_at)}</td>
                  </tr>
                ))}
                {filteredRecentSecurityEvents.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">No security events found for the selected time window.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Type</th>
              <th>Plan</th>
              <th>AI access</th>
              <th>AI model</th>
              <th>Enterprise owner</th>
              <th>Role</th>
              <th>Status</th>
              <th>Blacklisted</th>
              <th>Created</th>
              <th>Last Login</th>
              <th>Last Seen</th>
              <th>Locked Until</th>
              <th>Logins</th>
              <th>Requests</th>
              <th>Deals</th>
              <th>Contacts</th>
              <th>Activities</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r) => (
              <tr key={r.id}>
                <td className="tdTitle">{r.email}</td>
                <td>{r.is_admin_account ? "Admin" : r.enterprise_owner_id ? "Enterprise member" : r.plan === "enterprise" ? "Enterprise owner" : "Solo user"}</td>
                <td>{r.plan === "enterprise" ? "Enterprise" : "Free"}</td>
                <td>
                  {r.llm_access_scope === "inherited_enterprise"
                    ? "Inherited"
                    : r.has_llm_api_key
                      ? "Direct"
                      : "None"}
                </td>
                <td>{r.llm_model || "-"}</td>
                <td>{r.enterprise_owner_id || "-"}</td>
                <td>{r.enterprise_member_role || "-"}</td>
                <td>{r.is_online ? "Online" : "Offline"}</td>
                <td>{r.is_blacklisted ? `Yes${r.blacklist_reason ? `: ${r.blacklist_reason}` : ""}` : "No"}</td>
                <td>{fmtDt(r.created_at)}</td>
                <td>{fmtDt(r.last_login_at)}</td>
                <td>{fmtDt(r.last_seen_at)}</td>
                <td>{r.locked_until ? fmtDt(r.locked_until) : "-"}</td>
                <td>{r.login_count}</td>
                <td>{r.request_count}</td>
                <td>{r.counts.deals}</td>
                <td>{r.counts.contacts}</td>
                <td>{r.counts.activities}</td>
              </tr>
            ))}
            {displayRows.length === 0 && !loading ? (
              <tr>
                <td colSpan={17} className="muted">
                  No users yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
