import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";

type AdminUserRow = {
  id: string;
  email: string;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  is_online: boolean;
  is_blacklisted: boolean;
  blacklist_reason: string;
  blacklisted_at: string | null;
  plan: "free" | "enterprise" | "builder";
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
  openrouter_base_url: string;
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

const demoEmployees: EnterpriseEmployeeRow[] = [
  {
    id: "demo-emp-broker",
    email: "broker1@northstonecrm.com",
    full_name: "Aarav Mehta",
    company: "Northstone Realty",
    role_label: "broker",
    created_at: "2026-05-08T10:00:00Z",
    is_blacklisted: false,
    blacklist_reason: "",
    blacklisted_at: null,
    counts: { deals: 18, closed_deals: 5, open_deals: 11, lost_deals: 2, contacts: 44, activities: 26 }
  },
  {
    id: "demo-emp-cp",
    email: "cp1@northstonecrm.com",
    full_name: "Riya Shah",
    company: "Northstone Realty",
    role_label: "cp",
    created_at: "2026-05-09T11:20:00Z",
    is_blacklisted: false,
    blacklist_reason: "",
    blacklisted_at: null,
    counts: { deals: 11, closed_deals: 3, open_deals: 6, lost_deals: 2, contacts: 29, activities: 18 }
  },
  {
    id: "demo-emp-employee",
    email: "ops1@northstonecrm.com",
    full_name: "Kabir Sethi",
    company: "Northstone Realty",
    role_label: "employee",
    created_at: "2026-05-10T09:10:00Z",
    is_blacklisted: false,
    blacklist_reason: "",
    blacklisted_at: null,
    counts: { deals: 7, closed_deals: 1, open_deals: 5, lost_deals: 1, contacts: 14, activities: 21 }
  }
];

const demoEnterprises: EnterpriseDetail[] = [
  {
    enterprise_owner_id: "demo-enterprise-owner",
    owner_email: "owner@northstonecrm.com",
    company: "Northstone Realty",
    llm_provider: "openrouter",
    llm_model: "openai/gpt-4o-mini",
    llm_allocated_at: "2026-05-12T08:30:00Z",
    has_llm_api_key: true,
    employee_limit: 25,
    employee_count: demoEmployees.length,
    counts: { deals: 36, contacts: 87, activities: 65 },
    employees: demoEmployees
  }
];

const demoAuditRows: AuditRow[] = [
  {
    id: "demo-audit-1",
    actor_user_id: "demo-owner",
    actor_email: "owner@northstonecrm.com",
    target_user_id: "demo-emp-broker",
    target_email: "broker1@northstonecrm.com",
    enterprise_owner_id: "demo-enterprise-owner",
    enterprise_owner_email: "owner@northstonecrm.com",
    kind: "enterprise.create_employee",
    summary: "Created employee broker1@northstonecrm.com",
    detail: "Role broker assigned under Northstone Realty.",
    readable_summary: "owner@northstonecrm.com added broker1@northstonecrm.com",
    created_at: "2026-05-14T09:45:00Z"
  },
  {
    id: "demo-audit-2",
    actor_user_id: "demo-admin",
    actor_email: "admin@northstonecrm.com",
    target_user_id: "demo-owner",
    target_email: "owner@northstonecrm.com",
    enterprise_owner_id: "demo-enterprise-owner",
    enterprise_owner_email: "owner@northstonecrm.com",
    kind: "admin.set-plan",
    summary: "Enabled enterprise access for owner@northstonecrm.com",
    detail: "Plan moved from free to enterprise for demo launch preview.",
    readable_summary: "Admin enabled enterprise plan for owner@northstonecrm.com",
    created_at: "2026-05-13T16:15:00Z"
  }
];

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

const demoSecurity: SecurityPosture = {
  jwt_secret_default: false,
  data_encryption_key_missing: false,
  admin_uses_plain_password: false,
  pbkdf2_rounds: 120000,
  pbkdf2_rounds_weak: false,
  login_max_attempts: 5,
  login_lockout_minutes: 15,
  locked_accounts: 1,
  recommendations: [
    "Review the one locked account and confirm it was a legitimate protection event.",
    "Keep AI key allocation limited to enterprise owners, not member accounts."
  ]
};

const demoCompliance: ComplianceReport = {
  generated_at: "2026-05-14T12:00:00Z",
  controls: {
    jwt_secret_configured: true,
    data_encryption_key_configured: true,
    admin_password_hashed: true,
    login_max_attempts: 5,
    login_lockout_minutes: 15,
    jwt_exp_days: 30
  },
  counts: {
    users_total: 6,
    enterprise_owners: 1,
    enterprise_members: 3,
    ai_assigned_accounts: 1,
    blacklisted_users: 1,
    locked_users: 1
  },
  recent_security_events: [
    {
      kind: "admin.blacklist",
      summary: "Blacklisted cp2@northstonecrm.com",
      detail: "Temporarily blocked after policy review.",
      created_at: "2026-05-14T08:10:00Z"
    }
  ],
  recent_audit_events: [
    {
      kind: "admin.set-llm-access",
      summary: "Allocated AI access to owner@northstonecrm.com",
      detail: "Model set to openai/gpt-4o-mini.",
      created_at: "2026-05-13T15:20:00Z"
    }
  ]
};

const demoSubscriptionAnalytics: SubscriptionAnalytics = {
  grain: "month",
  timeline: [
    { label: "Jan", enterprise: 1, builder: 0, total: 1 },
    { label: "Feb", enterprise: 2, builder: 0, total: 2 },
    { label: "Mar", enterprise: 2, builder: 1, total: 3 },
    { label: "Apr", enterprise: 3, builder: 1, total: 4 },
    { label: "May", enterprise: 4, builder: 2, total: 6 }
  ],
  current_mix: { free: 2, enterprise: 3, builder: 1 },
  tracked_subscriptions: 6,
  revenue_supported: false,
  profit_supported: false,
  note: "Demo preview mode: sample subscription momentum for admin validation."
};

const demoRows: AdminUserRow[] = [
  {
    id: "demo-admin",
    email: "admin@northstonecrm.com",
    created_at: "2026-05-01T08:00:00Z",
    last_login_at: "2026-05-14T11:05:00Z",
    last_seen_at: "2026-05-14T11:18:00Z",
    is_online: true,
    is_blacklisted: false,
    blacklist_reason: "",
    blacklisted_at: null,
    plan: "free",
    enterprise_enabled_at: null,
    enterprise_owner_id: "",
    enterprise_member_role: "",
    employee_limit: 0,
    llm_provider: "",
    llm_model: "",
    llm_allocated_at: null,
    has_llm_api_key: false,
    llm_access_scope: "direct",
    login_count: 28,
    request_count: 194,
    locked_until: null,
    counts: { deals: 0, contacts: 0, activities: 0 },
    is_admin_account: true
  },
  {
    id: "demo-owner",
    email: "owner@northstonecrm.com",
    created_at: "2026-05-02T09:10:00Z",
    last_login_at: "2026-05-14T10:55:00Z",
    last_seen_at: "2026-05-14T11:12:00Z",
    is_online: true,
    is_blacklisted: false,
    blacklist_reason: "",
    blacklisted_at: null,
    plan: "enterprise",
    enterprise_enabled_at: "2026-05-03T10:00:00Z",
    enterprise_owner_id: "",
    enterprise_member_role: "",
    employee_limit: 25,
    llm_provider: "openrouter",
    llm_model: "openai/gpt-4o-mini",
    llm_allocated_at: "2026-05-12T08:30:00Z",
    has_llm_api_key: true,
    llm_access_scope: "direct",
    login_count: 19,
    request_count: 132,
    locked_until: null,
    counts: { deals: 36, contacts: 87, activities: 65 },
    is_admin_account: false
  },
  {
    id: "demo-emp-broker",
    email: "broker1@northstonecrm.com",
    created_at: "2026-05-08T10:00:00Z",
    last_login_at: "2026-05-14T09:42:00Z",
    last_seen_at: "2026-05-14T10:15:00Z",
    is_online: false,
    is_blacklisted: false,
    blacklist_reason: "",
    blacklisted_at: null,
    plan: "free",
    enterprise_enabled_at: null,
    enterprise_owner_id: "demo-enterprise-owner",
    enterprise_member_role: "broker",
    employee_limit: 0,
    llm_provider: "",
    llm_model: "",
    llm_allocated_at: null,
    has_llm_api_key: false,
    llm_access_scope: "inherited_enterprise",
    login_count: 11,
    request_count: 58,
    locked_until: null,
    counts: { deals: 18, contacts: 44, activities: 26 },
    is_admin_account: false
  }
];

export default function AdminPage() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseDetail[]>([]);
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string>("");
  const [selectedEnterprise, setSelectedEnterprise] = useState<EnterpriseDetail | null>(null);
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
  const [adminEmail, setAdminEmail] = useState("");
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forceDemoPreview, setForceDemoPreview] = useState(false);

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
  const [unlockEmail, setUnlockEmail] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockMsg, setUnlockMsg] = useState<string | null>(null);

  const [limitEmail, setLimitEmail] = useState("");
  const [limitValue, setLimitValue] = useState(0);
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  const [llmEmail, setLlmEmail] = useState("");
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
    openrouter_base_url: "",
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

  const hasLiveSubscriptionData = Boolean(
    subscriptionAnalytics &&
      (subscriptionAnalytics.tracked_subscriptions > 0 ||
        subscriptionAnalytics.timeline.some((item) => item.total > 0))
  );
  const autoDemoPreview =
    !loading &&
    rows.length === 0 &&
    enterprises.length === 0 &&
    auditRows.length === 0 &&
    !hasLiveSubscriptionData;
  const showDemoPreview = forceDemoPreview || autoDemoPreview;
  const displayRows = showDemoPreview ? demoRows : rows;
  const displayEnterprises = showDemoPreview ? demoEnterprises : enterprises;
  const displaySecurity = showDemoPreview ? demoSecurity : security;
  const displayCompliance = showDemoPreview ? demoCompliance : compliance;
  const displaySubscriptionAnalytics = showDemoPreview ? demoSubscriptionAnalytics : subscriptionAnalytics;
  const displayAuditRows = showDemoPreview ? demoAuditRows : auditRows;

  async function loadEnterpriseDetails(nextId: string, enterpriseRows?: EnterpriseDetail[]) {
    if (!nextId) {
      setSelectedEnterprise(null);
      setChatRows([]);
      return;
    }
    const local = (enterpriseRows ?? enterprises).find((enterprise) => enterprise.enterprise_owner_id === nextId) ?? null;
      setSelectedEnterprise(local);
      try {
        const [detail, chat] = await Promise.all([
          api<EnterpriseDetail>(`/admin/enterprises/${nextId}`),
          api<SupportChatRow[]>(`/admin/support-chat/${nextId}`)
        ]);
        setEnterprises((prev) =>
          prev.map((enterprise) =>
            enterprise.enterprise_owner_id === detail.enterprise_owner_id ? detail : enterprise
          )
        );
        setSelectedEnterprise(detail);
        setChatRows(chat);
      } catch (e) {
      setSelectedEnterprise(local);
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
        const [users, enterpriseRows, securityPosture, complianceReport, runtime, subscriptionData] = await Promise.all([
        api<AdminUserRow[]>("/admin/users"),
        api<EnterpriseDetail[]>("/admin/enterprises"),
        api<SecurityPosture>("/admin/security-posture"),
        api<ComplianceReport>("/admin/compliance-report"),
        api<RuntimeConfig>("/admin/runtime-config"),
        api<SubscriptionAnalytics>(`/admin/subscription-analytics?grain=${subscriptionGrain}`)
      ]);
      const adminMe = await api<{ is_admin: boolean; email: string }>("/admin/me");
      setRows(users);
      setEnterprises(enterpriseRows);
      setSecurity(securityPosture);
      setCompliance(complianceReport);
      setSubscriptionAnalytics(subscriptionData);
      setRuntimeConfig(runtime);
      setAdminEmail(adminMe.email || "");
      setConfigForm((prev) => ({
        ...prev,
        frontend_origin: runtime.frontend_origin || "",
        openrouter_base_url: runtime.openrouter_base_url || "",
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
  const visibleAuditRows = auditListExpanded ? displayAuditRows : displayAuditRows.slice(0, 1);
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

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Admin Portal</div>
          <div className="muted">Users, access, and enterprise oversight.</div>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => setForceDemoPreview((value) => !value)} type="button">
            {showDemoPreview ? "Hide demo preview" : "Show demo preview"}
          </button>
          <button className="btn ghost" onClick={() => void load()} type="button">
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="muted">Loading...</div> : null}

      {showDemoPreview ? <div className="alert ok">Demo preview mode is active because live admin data is still empty. These sample numbers help you validate the admin layout without changing the real database.</div> : null}

      {displaySecurity ? (
        <section className="card premiumPanel">
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
        <section className="card premiumPanel">
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
                  openrouter_base_url: configForm.openrouter_base_url,
                  admin_email: configForm.admin_email,
                  pbkdf2_rounds: configForm.pbkdf2_rounds,
                  login_max_attempts: configForm.login_max_attempts,
                  login_lockout_minutes: configForm.login_lockout_minutes,
                  jwt_exp_days: configForm.jwt_exp_days,
                  store_admin_password_as_hash: configForm.store_admin_password_as_hash,
                  ...(configForm.jwt_secret.trim() ? { jwt_secret: configForm.jwt_secret } : {}),
                  ...(configForm.admin_password.trim() ? { admin_password: configForm.admin_password } : {}),
                  ...(configForm.data_encryption_key.trim() ? { data_encryption_key: configForm.data_encryption_key } : {})
                };
                const updated = await api<RuntimeConfig>("/admin/runtime-config", {
                  method: "POST",
                  body: JSON.stringify(payload)
                });
                setRuntimeConfig(updated);
                setConfigForm((prev) => ({ ...prev, jwt_secret: "", admin_password: "", data_encryption_key: "" }));
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
                OpenRouter base URL
                <input value={configForm.openrouter_base_url} onChange={(e) => setConfigForm((prev) => ({ ...prev, openrouter_base_url: e.target.value }))} />
              </label>
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
        <section className="card premiumPanel">
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

      <section className="card">
        <div className="cardTitle">Reset user password</div>
        <form
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
              <input value={planEmail} onChange={(e) => setPlanEmail(e.target.value)} placeholder="owner@example.com" list="admin-user-emails" />
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
              <input value={limitEmail} onChange={(e) => setLimitEmail(e.target.value)} placeholder="owner@example.com" list="admin-user-emails" />
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
              <input value={llmEmail} onChange={(e) => setLlmEmail(e.target.value)} placeholder="owner-or-user@example.com" list="admin-user-emails" />
              <datalist id="admin-user-emails">
                {rows.map((row) => (
                  <option key={row.id} value={row.email}>
                    {row.is_admin_account ? "Admin" : row.enterprise_owner_id ? "Organization member" : row.plan === "builder" ? "Builder owner" : row.plan === "enterprise" ? "Enterprise owner" : "Solo user"}
                  </option>
                ))}
              </datalist>
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

      <section className="card">
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

      <section className="card">
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
        <section className="card premiumPanel">
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
              <div className="statHint">Accounts with centrally managed AI access.</div>
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
          <div className="muted small">Generated {fmtDt(displayCompliance.generated_at)}</div>
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
                {displayCompliance.recent_security_events.map((item, idx) => (
                  <tr key={`${item.kind}-${item.created_at}-${idx}`}>
                    <td className="tdTitle">{item.summary}</td>
                    <td>{item.detail || "-"}</td>
                    <td>{fmtDt(item.created_at)}</td>
                  </tr>
                ))}
                {displayCompliance.recent_security_events.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">No recent security events.</td>
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
