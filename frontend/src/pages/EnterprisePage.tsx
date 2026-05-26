import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Profile } from "../api/types";
import BuilderWebsiteDesk from "../components/BuilderWebsiteDesk";

type MarketInsightRow = {
  city: string;
  area: string;
  window_days: number;
  deals: number;
  active: number;
  closed: number;
  lost: number;
  absorption_rate: number;
  avg_ticket_size: number | null;
  pricing_signal_30d: "up" | "down" | "flat";
};

type MarketInsightsResponse = {
  now: string;
  window_days: number;
  areas: MarketInsightRow[];
};

type PortfolioAnalyticsResponse = {
  now: string;
  window_days: number;
  total_deals: number;
  stage_counts: Record<string, number>;
  exposure_ticket_size_sum: number;
  weighted_expected_roi_pct: number | null;
};

type DealRow = { id: string; title: string; city: string; area: string; stage: string };

type DealScoreResponse = {
  deal_id: string;
  close_probability: number;
  risk_flags: string[];
  rationale: string[];
};

type TextReport = { deal_id: string; format: string; content: string };

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

type EnterpriseOverview = {
  enterprise_owner_id: string;
  owner_email: string;
  owner_plan: "enterprise" | "builder";
  company: string;
  company_city: string;
  company_areas_served: string;
  company_specialization: string;
  company_bio: string;
  company_profile_complete: boolean;
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

type BuilderDocumentRow = {
  id: string;
  owner_id: string;
  enterprise_owner_id: string | null;
  created_by_user_id: string | null;
  doc_type: string;
  project_name: string;
  company_name: string;
  client_name: string;
  project_city: string;
  instructions: string;
  generated_text: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type EnterpriseContext = {
  plan: string;
  enterprise_owner_id: string | null;
  is_enterprise_owner: boolean;
  is_enterprise_member: boolean;
  access_role: string;
  can_manage: boolean;
  can_view: boolean;
  integrations: { key: string; name: string; status: string }[];
};

type UpgradePrompt = {
  title: string;
  message: string;
  targetPlan: "enterprise" | "builder";
};

function fmtDt(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatRupees(value: number | null, compact = false) {
  if (value == null) return "N/A";
  if (!compact) return `₹${Math.round(value).toLocaleString("en-IN")}`;
  const abs = Math.abs(value);
  if (abs >= 10000000) {
    return `₹${(value / 10000000).toFixed(abs >= 100000000 ? 0 : 1).replace(/\.0$/, "")} Cr`;
  }
  if (abs >= 100000) {
    return `₹${(value / 100000).toFixed(abs >= 1000000 ? 0 : 1).replace(/\.0$/, "")} L`;
  }
  if (abs >= 1000) {
    return `₹${(value / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(/\.0$/, "")} K`;
  }
  return `₹${Math.round(value)}`;
}

function builderDocLabel(docType: string) {
  switch (docType) {
    case "company_profile":
      return "Company profile";
    case "project_update":
      return "Project update";
    case "sales_offer":
      return "Sales offer";
    case "compliance_cover_letter":
      return "Compliance cover letter";
    case "construction_summary":
      return "Construction summary";
    case "builder_brochure":
      return "Builder brochure";
    default:
      return "Project overview";
  }
}

export default function EnterprisePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<EnterpriseOverview | null>(null);
  const [enterpriseContext, setEnterpriseContext] = useState<EnterpriseContext | null>(null);
  const [companyProfile, setCompanyProfile] = useState<Profile | null>(null);
  const [market, setMarket] = useState<MarketInsightsResponse | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioAnalyticsResponse | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [chatRows, setChatRows] = useState<SupportChatRow[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [compactAvgTicket, setCompactAvgTicket] = useState(true);
  const [builderDocuments, setBuilderDocuments] = useState<BuilderDocumentRow[]>([]);
  const [docBusy, setDocBusy] = useState(false);
  const [docMsg, setDocMsg] = useState<string | null>(null);
  const [deletingBuilderDocId, setDeletingBuilderDocId] = useState<string | null>(null);
  const [governanceExpanded, setGovernanceExpanded] = useState(false);
  const [docForm, setDocForm] = useState({
    doc_type: "project_overview",
    tone: "professional",
    project_name: "",
    company_name: "",
    client_name: "",
    project_city: "",
    instructions: ""
  });
  const docInstructionsLength = docForm.instructions.trim().length;
  const docInstructionsReady = docInstructionsLength >= 10;

  const [dealId, setDealId] = useState("");
  const [score, setScore] = useState<DealScoreResponse | null>(null);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [report, setReport] = useState<TextReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [memo, setMemo] = useState<TextReport | null>(null);
  const [memoBusy, setMemoBusy] = useState(false);

  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeCompany, setEmployeeCompany] = useState("");
  const [employeeRole, setEmployeeRole] = useState<"broker" | "cp" | "employee">("broker");
  const [employeeBusy, setEmployeeBusy] = useState(false);
  const [employeeMsg, setEmployeeMsg] = useState<string | null>(null);
  const [companyBusy, setCompanyBusy] = useState(false);
  const [companyMsg, setCompanyMsg] = useState<string | null>(null);
  const visibleGovernanceRows = governanceExpanded ? auditRows : auditRows.slice(0, 1);
  const [previewMode, setPreviewMode] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<UpgradePrompt | null>(null);

  const dealOptions = useMemo(() => deals.map((d) => ({ value: d.id, label: `${d.title} (${d.stage})` })), [deals]);

  function openUpgradePrompt(message: string, targetPlan: "enterprise" | "builder" = "enterprise", title = "Upgrade to unlock") {
    setUpgradePrompt({ title, message, targetPlan });
  }

  async function deleteBuilderDocument(doc: BuilderDocumentRow) {
    const confirmed = window.confirm(`Delete this builder draft${doc.project_name ? ` for "${doc.project_name}"` : ""}?`);
    if (!confirmed) return;
    setDeletingBuilderDocId(doc.id);
    setError(null);
    try {
      await api<{ deleted: boolean }>(`/enterprise/builder-documents/${doc.id}`, { method: "DELETE" });
      setBuilderDocuments((prev) => prev.filter((row) => row.id !== doc.id));
      setDocMsg("Builder draft deleted.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete builder draft";
      setError(message);
      setDocMsg(message);
    } finally {
      setDeletingBuilderDocId(null);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    setPreviewMode(false);
    try {
      let context: EnterpriseContext;
      try {
        context = await api<EnterpriseContext>("/enterprise/integrations");
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          setPreviewMode(true);
          setEnterpriseContext({
            plan: "free",
            enterprise_owner_id: null,
            is_enterprise_owner: false,
            is_enterprise_member: false,
            access_role: "public_preview",
            can_manage: false,
            can_view: false,
            integrations: []
          });
          const [profileResp, dealsResp] = await Promise.allSettled([api<Profile>("/profile"), api<DealRow[]>("/deals")]);
          if (profileResp.status === "fulfilled") setCompanyProfile(profileResp.value);
          if (dealsResp.status === "fulfilled") {
            setDeals(dealsResp.value);
            if (!dealId && dealsResp.value.length) setDealId(dealsResp.value[0].id);
          }
          setOverview(null);
          setMarket(null);
          setPortfolio(null);
          setAuditRows([]);
          setChatRows([]);
          setBuilderDocuments([]);
          return;
        }
        throw e;
      }
      const [o, profile, marketResp, portfolioResp, dealsResp, auditResp, chatResp, docsResp] = await Promise.all([
        api<EnterpriseOverview>("/enterprise/overview"),
        api<Profile>("/profile"),
        api<MarketInsightsResponse>("/enterprise/market-insights?window_days=90"),
        api<PortfolioAnalyticsResponse>("/enterprise/portfolio/analytics?window_days=365"),
        api<DealRow[]>("/deals"),
        api<AuditRow[]>("/enterprise/audit?limit=20"),
        api<SupportChatRow[]>("/enterprise/support-chat"),
        api<BuilderDocumentRow[]>("/enterprise/builder-documents")
      ]);
      setEnterpriseContext(context);
      setOverview(o);
      setCompanyProfile(profile);
      setMarket(marketResp);
      setPortfolio(portfolioResp);
      setDeals(dealsResp);
      setAuditRows(auditResp);
      setChatRows(chatResp);
      setBuilderDocuments(docsResp);
      if (!dealId && dealsResp.length) setDealId(dealsResp[0].id);
      setDocForm((prev) => ({
        ...prev,
        company_name: prev.company_name || profile.company || o.company || "",
        project_city: prev.project_city || profile.city || o.company_city || ""
      }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError("Enterprise owner access is required for this section.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load enterprise data");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stageOrder = ["lead", "visit", "negotiation", "closed", "lost"];
  const companySetupComplete = Boolean(overview?.company_profile_complete);
  const isEnterpriseOwner = Boolean(enterpriseContext?.can_manage);
  const isLimitedMember = Boolean(enterpriseContext && !enterpriseContext.can_manage);
  const hasOrganizationAccess = Boolean(enterpriseContext?.can_view || enterpriseContext?.can_manage);
  const publicPreviewMode = previewMode || (!loading && !hasOrganizationAccess);
  const showOrganizationFeatures = companySetupComplete || publicPreviewMode;

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Organization</div>
          <div className="muted">Team management, builder operations, and rollups.</div>
        </div>
        <button className="btn ghost" onClick={() => void load()} type="button">
          Refresh
        </button>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="muted">Loading...</div> : null}
      {publicPreviewMode ? (
        <div className="alert ok">
          Public preview mode: everyone can see the organization workspace during demos and onboarding, but live team controls,
          org analytics, builder document automation, and governance actions unlock only with an Enterprise or Builder subscription.
        </div>
      ) : null}
      {isLimitedMember ? (
        <div className="alert ok">
          Limited enterprise access: you can review company progress and inherited organization visibility as a {enterpriseContext?.access_role || "team member"}, but only the owner can manage employees, edit company setup, or create builder documents.
        </div>
      ) : null}

      <section className="card premiumPanel">
        <div className="cardTitle">Organization overview</div>
        {overview ? (
          <div className="statsGrid">
            <div className="statCard">
              <div className="statLabel">Owner</div>
              <div className="statValue">{overview.owner_email}</div>
              <div className="statHint">{overview.company || "Enterprise company name not set yet."}</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Employee capacity</div>
              <div className="statValue">
                {overview.employee_count}/{overview.employee_limit}
              </div>
              <div className="statHint">Team visibility and licensing control.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Combined deals</div>
              <div className="statValue">{overview.counts.deals}</div>
              <div className="statHint">All employee pipeline rolled into one manager view.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Combined activities</div>
              <div className="statValue">{overview.counts.activities}</div>
              <div className="statHint">Operational velocity across the enterprise team.</div>
            </div>
          </div>
        ) : null}
        {overview ? (
          <div className="grid2">
            <div className="mini">
              <div>
                <b>Owner:</b> {overview.owner_email}
              </div>
              <div>
                <b>Company:</b> {overview.company || "N/A"}
              </div>
              <div>
                <b>City:</b> {overview.company_city || "N/A"}
              </div>
              <div>
                <b>Employee usage:</b> {overview.employee_count} / {overview.employee_limit}
              </div>
            </div>
            <div className="mini">
              <div>
                <b>Areas served:</b> {overview.company_areas_served || "N/A"}
              </div>
              <div>
                <b>Specialization:</b> {overview.company_specialization || "N/A"}
              </div>
              <div>
                <b>Total deals:</b> {overview.counts.deals}
              </div>
              <div>
                <b>Total contacts:</b> {overview.counts.contacts}
              </div>
              <div>
                <b>Total activities:</b> {overview.counts.activities}
              </div>
            </div>
          </div>
        ) : publicPreviewMode ? (
          <div className="statsGrid">
            <div className="statCard">
              <div className="statLabel">Owner view</div>
              <div className="statValue">Preview</div>
              <div className="statHint">Enterprise and Builder subscriptions unlock live organization ownership.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Employee capacity</div>
              <div className="statValue">Locked</div>
              <div className="statHint">Create brokers, CPs, and employee IDs after upgrading.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Combined deals</div>
              <div className="statValue">{deals.length}</div>
              <div className="statHint">Your personal CRM data is visible now. Team rollups unlock after upgrade.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Organization controls</div>
              <div className="statValue">Preview</div>
              <div className="statHint">Use this preview in demos. Real controls activate with the right plan.</div>
            </div>
          </div>
        ) : (
          <div className="muted">No enterprise overview yet.</div>
        )}
      </section>

      <section className="card">
        <div className="cardTitle">Organization company setup</div>
        <div className="muted">
          Complete these safe public company details before enterprise features unlock. Sensitive items like PAN, GSTIN, and private compliance data are not shown here.
        </div>
        {isEnterpriseOwner && companyProfile ? (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setCompanyBusy(true);
              setCompanyMsg(null);
              try {
                const saved = await api<Profile>("/profile", {
                  method: "PUT",
                  body: JSON.stringify({
                    ...companyProfile,
                    rera_id: companyProfile.rera_id ?? "",
                    pan: companyProfile.pan ?? "",
                    gstin: companyProfile.gstin ?? ""
                  })
                });
                setCompanyProfile(saved);
                setCompanyMsg("Enterprise company profile saved.");
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not save company profile");
              } finally {
                setCompanyBusy(false);
              }
            }}
          >
            <div className="grid2">
              <label>
                Enterprise company name
                <input value={companyProfile.company} onChange={(e) => setCompanyProfile({ ...companyProfile, company: e.target.value })} placeholder="Lodha Realty" />
              </label>
              <label>
                City
                <input value={companyProfile.city} onChange={(e) => setCompanyProfile({ ...companyProfile, city: e.target.value })} placeholder="Mumbai" />
              </label>
            </div>
            <div className="grid2">
              <label>
                Areas served
                <input value={companyProfile.areas_served} onChange={(e) => setCompanyProfile({ ...companyProfile, areas_served: e.target.value })} placeholder="Thane, Powai, Lower Parel" />
              </label>
              <label>
                Specialization
                <input value={companyProfile.specialization} onChange={(e) => setCompanyProfile({ ...companyProfile, specialization: e.target.value })} placeholder="Residential, luxury, commercial" />
              </label>
            </div>
            <label>
              Public company summary
              <textarea
                className="textarea"
                value={companyProfile.bio}
                onChange={(e) => setCompanyProfile({ ...companyProfile, bio: e.target.value })}
                placeholder="Short non-sensitive company description visible in enterprise summaries."
              />
            </label>
            {companyMsg ? <div className="alert ok">{companyMsg}</div> : null}
            {!companySetupComplete ? <div className="alert">Complete company name, city, areas served, specialization, and public summary to unlock organization features.</div> : null}
            <button className="btn" type="submit" disabled={companyBusy}>
              {companyBusy ? "Saving..." : "Save company details"}
            </button>
          </form>
        ) : publicPreviewMode ? (
          <div className="grid2">
            <div className="mini">
              <div>
                <b>Company:</b> Upgrade required
              </div>
              <div>
                <b>City:</b> Upgrade required
              </div>
              <div>
                <b>Areas served:</b> Upgrade required
              </div>
            </div>
            <div className="mini">
              <div>
                <b>Specialization:</b> Upgrade required
              </div>
              <div>
                <b>Public summary:</b> Company-facing enterprise profile unlocks after upgrade.
              </div>
              <button className="btn" type="button" onClick={() => openUpgradePrompt("Upgrade to Enterprise or Builder to activate company setup, employee controls, and organization reporting.")}>
                Unlock organization workspace
              </button>
            </div>
          </div>
        ) : overview ? (
          <div className="grid2">
            <div className="mini">
              <div>
                <b>Company:</b> {overview.company || "N/A"}
              </div>
              <div>
                <b>City:</b> {overview.company_city || "N/A"}
              </div>
              <div>
                <b>Areas served:</b> {overview.company_areas_served || "N/A"}
              </div>
            </div>
            <div className="mini">
              <div>
                <b>Specialization:</b> {overview.company_specialization || "N/A"}
              </div>
              <div>
                <b>Public summary:</b> {overview.company_bio || "N/A"}
              </div>
              <div className="muted small">Only the enterprise owner can edit organization company details.</div>
            </div>
          </div>
        ) : (
          <div className="muted">Loading company profile...</div>
        )}
      </section>

      {!companySetupComplete && !publicPreviewMode ? (
        <section className="card">
          <div className="cardTitle">Organization features locked</div>
          <div className="muted">
            Finish the organization company setup above first. After that, employee management, analytics, builder documents, reports, and other organization tools will unlock.
          </div>
        </section>
      ) : null}

      {showOrganizationFeatures ? (
        <>
      {isEnterpriseOwner ? (
      <section className="card">
        <div className="cardTitle">Create broker / CP / employee ID</div>
        <div className="muted">These users get the normal CRM interface, and all of their data rolls up into this enterprise account.</div>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!employeeEmail.trim() || employeePassword.length < 8) return;
            setEmployeeBusy(true);
            setEmployeeMsg(null);
            try {
              await api<EnterpriseEmployeeRow>("/enterprise/employees", {
                method: "POST",
                body: JSON.stringify({
                  email: employeeEmail,
                  password: employeePassword,
                  full_name: employeeName,
                  company: employeeCompany,
                  role_label: employeeRole
                })
              });
              setEmployeeMsg("Employee ID created.");
              setEmployeeEmail("");
              setEmployeePassword("");
              setEmployeeName("");
              setEmployeeCompany("");
              setEmployeeRole("broker");
              await load();
            } catch (err) {
              setEmployeeMsg(err instanceof Error ? err.message : "Could not create employee");
            } finally {
              setEmployeeBusy(false);
            }
          }}
        >
          <div className="grid2">
            <label>
              Email
              <input value={employeeEmail} onChange={(e) => setEmployeeEmail(e.target.value)} placeholder="broker@company.com" />
            </label>
            <label>
              Password
              <input value={employeePassword} onChange={(e) => setEmployeePassword(e.target.value)} type="password" placeholder="Minimum 8 characters" />
            </label>
          </div>
          <div className="grid2">
            <label>
              Full name
              <input value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} placeholder="Broker name" />
            </label>
            <label>
              Company
              <input value={employeeCompany} onChange={(e) => setEmployeeCompany(e.target.value)} placeholder="Organization name" />
            </label>
          </div>
          <label>
            Role
            <select value={employeeRole} onChange={(e) => setEmployeeRole((e.target.value as "broker" | "cp" | "employee") ?? "broker")}>
              <option value="broker">Broker</option>
              <option value="cp">CP</option>
              <option value="employee">Employee</option>
            </select>
          </label>
          {employeeMsg ? <div className="alert ok">{employeeMsg}</div> : null}
          <button className="btn" type="submit" disabled={employeeBusy || !employeeEmail.trim() || employeePassword.length < 8}>
            {employeeBusy ? "Creating..." : "Create employee ID"}
          </button>
        </form>
      </section>
      ) : (
      <section className="card">
        <div className="cardTitle">Create broker / CP / employee ID</div>
        <div className="muted">
          Everyone can preview this workflow, but only Enterprise and Builder owners can create managed team IDs and roll their work into one organization cockpit.
        </div>
        <button className="btn" type="button" onClick={() => openUpgradePrompt("Upgrade to Enterprise to create broker, CP, and employee IDs under one organization owner account.")}>
          Unlock team creation
        </button>
      </section>
      )}

      <section className="card">
        <div className="cardTitle">Employee list</div>
        <div className="muted small">Slide horizontally to view full email, created date, and action columns.</div>
        <div className="tableWrap tableWrapWide">
          <table className="table tableWide">
            <thead>
              <tr>
                <th>Name</th>
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {overview?.employees.map((employee) => (
                <tr key={employee.id}>
                  <td className="tdTitle">{employee.full_name || "-"}</td>
                  <td>{employee.email}</td>
                  <td>{employee.company || overview?.company || "-"}</td>
                  <td>{employee.role_label}</td>
                  <td>{employee.is_blacklisted ? `Blacklisted${employee.blacklist_reason ? `: ${employee.blacklist_reason}` : ""}` : "Active"}</td>
                  <td>{employee.counts.deals}</td>
                  <td>{employee.counts.closed_deals ?? 0}</td>
                  <td>{employee.counts.open_deals ?? 0}</td>
                  <td>{employee.counts.lost_deals ?? 0}</td>
                  <td>{employee.counts.contacts}</td>
                  <td>{employee.counts.activities}</td>
                  <td>{fmtDt(employee.created_at)}</td>
                  <td>
                    <div className="row">
                      {isEnterpriseOwner ? (
                        <>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={async () => {
                          try {
                            await api(`/enterprise/employees/${employee.id}/blacklist`, {
                              method: "POST",
                              body: JSON.stringify({
                                blacklisted: !employee.is_blacklisted,
                                reason: employee.is_blacklisted ? "" : `Blocked by ${overview?.owner_email ?? "enterprise owner"}`
                              })
                            });
                            await load();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Could not update employee status");
                          }
                        }}
                      >
                        {employee.is_blacklisted ? "Unblacklist" : "Blacklist"}
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={async () => {
                          try {
                            await api(`/enterprise/employees/${employee.id}`, { method: "DELETE" });
                            await load();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Could not delete employee");
                          }
                        }}
                      >
                        Delete
                      </button>
                        </>
                      ) : (
                        <span className="muted small">Read-only for members</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!overview?.employees.length && !loading ? (
                <tr>
                  <td colSpan={13} className="muted">
                    {publicPreviewMode ? "Upgrade to Enterprise or Builder to unlock employee rollups, blacklist controls, and organization-wide visibility." : "No employee IDs created yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card premiumPanel">
        <div className="cardTitle">Admin support chat</div>
        <div className="muted small">Use this thread to ask admin for enterprise setup help, limits, AI access, or anything else that needs intervention.</div>
        {publicPreviewMode ? (
          <div className="row">
            <button className="btn" type="button" onClick={() => openUpgradePrompt("Upgrade first, then use the organization support thread for setup, limits, AI access, and builder operations help.")}>
              Unlock support thread
            </button>
          </div>
        ) : null}
        <div className="chatList">
          {chatRows.length === 0 ? <div className="muted">No conversation yet.</div> : null}
          {chatRows.map((item) => (
            <div key={item.id} className={`chatBubble ${item.sender_role === "enterprise_owner" ? "chatBubbleAdmin" : ""}`}>
              <div className="chatMeta">
                <b>{item.sender_role === "admin" ? "Admin" : item.sender_role === "enterprise_member" ? "Team member" : "You"}</b>
                <span>{item.sender_email || "-"}</span>
                <span>{fmtDt(item.created_at)}</span>
              </div>
              <div>{item.message}</div>
            </div>
          ))}
        </div>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!chatDraft.trim()) return;
            setChatBusy(true);
            try {
              await api<SupportChatRow>("/enterprise/support-chat", {
                method: "POST",
                body: JSON.stringify({ message: chatDraft })
              });
              setChatDraft("");
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not send message");
            } finally {
              setChatBusy(false);
            }
          }}
        >
          <label>
            Message admin
            <textarea className="textarea" value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder="Write your request to admin here..." />
          </label>
          <button className="btn" type="submit" disabled={chatBusy || !chatDraft.trim()}>
            {chatBusy ? "Sending..." : "Send to admin"}
          </button>
        </form>
      </section>

      {isEnterpriseOwner && overview?.owner_plan === "builder" ? <BuilderWebsiteDesk /> : null}

      <section className="card premiumPanel">
        <div className="cardTitle">Builder and construction document desk</div>
        <div className="muted small">
          This workspace is for builder and construction subscriptions that need AI-drafted company profiles, project overviews, sales offers, compliance cover letters, and other human-sounding first drafts.
          AI access here uses the OpenRouter key already assigned by admin to the owner account. No separate automatic AI link is generated from OpenRouter.
        </div>
        {isEnterpriseOwner ? (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!docInstructionsReady) {
              setDocMsg("Add at least 10 characters of facts or instructions before saving the builder brief.");
              return;
            }
            setDocBusy(true);
            setDocMsg(null);
            try {
              await api<BuilderDocumentRow>("/enterprise/builder-documents", {
                method: "POST",
                body: JSON.stringify({
                  doc_type: docForm.doc_type,
                  project_name: docForm.project_name,
                  company_name: docForm.company_name,
                  client_name: docForm.client_name,
                  project_city: docForm.project_city,
                  instructions: docForm.instructions
                })
              });
              setDocMsg("Builder document brief saved.");
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save builder document brief");
            } finally {
              setDocBusy(false);
            }
          }}
        >
          <div className="grid2">
            <label>
              Document type
              <select value={docForm.doc_type} onChange={(e) => setDocForm((prev) => ({ ...prev, doc_type: e.target.value }))}>
                <option value="project_overview">Project overview</option>
                <option value="company_profile">Company profile</option>
                <option value="project_update">Project update</option>
                <option value="sales_offer">Sales offer</option>
                <option value="compliance_cover_letter">Compliance cover letter</option>
                <option value="construction_summary">Construction summary</option>
                <option value="builder_brochure">Builder brochure</option>
              </select>
            </label>
            <label>
              Tone
              <select value={docForm.tone} onChange={(e) => setDocForm((prev) => ({ ...prev, tone: e.target.value }))}>
                <option value="professional">Professional</option>
                <option value="premium">Premium</option>
                <option value="sales">Sales</option>
                <option value="compliance">Compliance</option>
              </select>
            </label>
          </div>
          <div className="grid2">
            <label>
              Project name
              <input value={docForm.project_name} onChange={(e) => setDocForm((prev) => ({ ...prev, project_name: e.target.value }))} placeholder="Skyline Residency Phase 2" />
            </label>
            <label>
              Company name
              <input value={docForm.company_name} onChange={(e) => setDocForm((prev) => ({ ...prev, company_name: e.target.value }))} placeholder="Your builder or construction company" />
            </label>
          </div>
          <div className="grid2">
            <label>
              Client or audience
              <input value={docForm.client_name} onChange={(e) => setDocForm((prev) => ({ ...prev, client_name: e.target.value }))} placeholder="Investor group, buyer, land owner, authority" />
            </label>
            <label>
              Project city
              <input value={docForm.project_city} onChange={(e) => setDocForm((prev) => ({ ...prev, project_city: e.target.value }))} placeholder="Pune" />
            </label>
          </div>
          <label>
            Facts and instructions
            <textarea
              className="textarea"
              value={docForm.instructions}
              onChange={(e) => setDocForm((prev) => ({ ...prev, instructions: e.target.value }))}
              placeholder="Write the exact facts, project details, construction status, amenities, approvals already available, target buyer, commercial points, and anything the draft must include."
            />
          </label>
          <div className="row">
            <button
              className="btn"
              type="button"
              disabled={docBusy || !docForm.instructions.trim()}
              onClick={async () => {
                if (!docInstructionsReady) {
                  setDocMsg("Add at least 10 characters of facts or instructions before generating an AI draft.");
                  return;
                }
                setDocBusy(true);
                setDocMsg(null);
                try {
                  await api<BuilderDocumentRow>("/enterprise/builder-documents/generate", {
                    method: "POST",
                    body: JSON.stringify(docForm)
                  });
                  setDocMsg("AI document draft generated.");
                  await load();
                } catch (err) {
                  const message = err instanceof Error ? err.message : "Could not generate builder document";
                  setDocMsg(message);
                  setError(message);
                } finally {
                  setDocBusy(false);
                }
              }}
            >
              {docBusy ? "Working..." : "Generate AI draft"}
            </button>
            <button className="btn ghost" type="submit" disabled={docBusy || !docInstructionsReady}>
              Save brief only
            </button>
          </div>
          <div className="muted small">
            Builder drafts need at least 10 characters of facts or instructions. Current length: {docInstructionsLength}/10 minimum.
          </div>
          {docMsg ? <div className="alert ok">{docMsg}</div> : null}
        </form>
        ) : (
          <div>
            <div className="muted small">Builder document creation and AI generation are available only to the enterprise owner.</div>
            <button className="btn" type="button" style={{ marginTop: 10 }} onClick={() => openUpgradePrompt("Upgrade to a Builder subscription to unlock AI builder documents, construction summaries, brochures, and owner-level document workflows.", "builder")}>
              Unlock builder documents
            </button>
          </div>
        )}
        {builderDocuments.length ? (
          <div className="list">
            {builderDocuments.slice(0, 8).map((doc) => (
              <div key={doc.id} className="listItem">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div className="grow">
                    <div><b>{builderDocLabel(doc.doc_type)}</b>{doc.project_name ? ` - ${doc.project_name}` : ""}</div>
                    <div className="muted small">
                      {doc.company_name || "No company name"}
                      {doc.project_city ? ` | ${doc.project_city}` : ""}
                      {doc.client_name ? ` | audience: ${doc.client_name}` : ""}
                      {doc.status ? ` | ${doc.status}` : ""}
                    </div>
                    {doc.generated_text ? (
                      <pre style={{ whiteSpace: "pre-wrap", margin: "12px 0 0 0" }}>{doc.generated_text}</pre>
                    ) : (
                      <div className="muted small" style={{ marginTop: 12 }}>{doc.instructions}</div>
                    )}
                  </div>
                  <div style={{ display: "grid", gap: 10, justifyItems: "end" }}>
                    <div className="muted small">{fmtDt(doc.updated_at)}</div>
                    {isEnterpriseOwner ? (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => void deleteBuilderDocument(doc)}
                        disabled={deletingBuilderDocId === doc.id}
                      >
                        {deletingBuilderDocId === doc.id ? "Deleting..." : "Delete draft"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">No builder document drafts yet.</div>
        )}
      </section>

      <section className="card">
        <div className="cardTitle">Portfolio analytics</div>
        {portfolio ? (
          <div className="grid2">
            <div className="mini">
              <div>
                <b>Total deals:</b> {portfolio.total_deals}
              </div>
              <div>
                <b>Exposure (sum ticket):</b> {formatRupees(portfolio.exposure_ticket_size_sum, false)}
              </div>
              <div>
                <b>Weighted ROI:</b>{" "}
                {portfolio.weighted_expected_roi_pct == null ? "N/A" : `${portfolio.weighted_expected_roi_pct.toFixed(1)}%`}
              </div>
            </div>
            <div className="mini">
              <div>
                <b>Pipeline</b>
              </div>
              {stageOrder.map((st) => (
                <div key={st}>
                  <b>{st}:</b> {portfolio.stage_counts?.[st] ?? 0}
                </div>
              ))}
              <div className="muted">Window: last {portfolio.window_days} days</div>
            </div>
          </div>
        ) : (
          <div className="muted">{publicPreviewMode ? "Upgrade to Enterprise or Builder to unlock organization portfolio analytics." : "No analytics yet."}</div>
        )}
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="cardTitle" style={{ marginBottom: 0 }}>AI market insights (organization-wide)</div>
          <button className="btn ghost" type="button" onClick={() => setCompactAvgTicket((value) => !value)}>
            Avg ticket: {compactAvgTicket ? "Cr/L" : "Figures"}
          </button>
        </div>
        {market && market.areas.length ? (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>City</th>
                  <th>Location</th>
                  <th>Deals</th>
                  <th>Absorption</th>
                  <th>Avg ticket</th>
                  <th>Pricing signal</th>
                </tr>
              </thead>
              <tbody>
                {market.areas.slice(0, 12).map((r) => (
                  <tr key={`${r.city}|${r.area}`}>
                    <td>{r.city || "-"}</td>
                    <td className="tdTitle">{r.area || "-"}</td>
                    <td>{r.deals}</td>
                    <td>{Math.round(r.absorption_rate * 100)}%</td>
                    <td>{formatRupees(r.avg_ticket_size, compactAvgTicket)}</td>
                    <td>{r.pricing_signal_30d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">{publicPreviewMode ? "Upgrade to unlock organization-wide AI market insights for cities, locations, absorption, and pricing signals." : "Add deals with city, area, and ticket size to see trends."}</div>
        )}
      </section>

      <section className="card">
        <div className="cardTitle">Predictive deal scoring and reports</div>
        <div className="form">
          <label>
            Select deal
            <select value={dealId} onChange={(e) => setDealId(e.target.value)}>
              {dealOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {dealOptions.length === 0 ? <option value="">No deals yet</option> : null}
            </select>
          </label>
          <div className="row">
            <button
              className="btn"
              type="button"
              disabled={scoreBusy}
              onClick={async () => {
                if (publicPreviewMode) {
                  openUpgradePrompt("Upgrade to Enterprise or Builder to score deals, generate investment reports, and produce AI-backed deal memos.");
                  return;
                }
                if (!dealId) return;
                setScoreBusy(true);
                setScore(null);
                try {
                  setScore(await api<DealScoreResponse>(`/enterprise/deal-score/${dealId}`, { method: "POST" }));
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Scoring failed");
                } finally {
                  setScoreBusy(false);
                }
              }}
            >
              {scoreBusy ? "Scoring..." : "Score"}
            </button>
            <button
              className="btn ghost"
              type="button"
              disabled={reportBusy}
              onClick={async () => {
                if (publicPreviewMode) {
                  openUpgradePrompt("Upgrade to Enterprise or Builder to generate investment reports directly from the organization workspace.");
                  return;
                }
                if (!dealId) return;
                setReportBusy(true);
                setReport(null);
                try {
                  setReport(await api<TextReport>(`/enterprise/reports/investment/${dealId}`, { method: "POST" }));
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Report failed");
                } finally {
                  setReportBusy(false);
                }
              }}
            >
              {reportBusy ? "Generating..." : "Investment report"}
            </button>
            <button
              className="btn ghost"
              type="button"
              disabled={memoBusy}
              onClick={async () => {
                if (publicPreviewMode) {
                  openUpgradePrompt("Upgrade to Enterprise or Builder to generate deal memos and predictive decision support.");
                  return;
                }
                if (!dealId) return;
                setMemoBusy(true);
                setMemo(null);
                try {
                  setMemo(await api<TextReport>(`/enterprise/deal-memo/${dealId}`, { method: "POST" }));
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Memo failed");
                } finally {
                  setMemoBusy(false);
                }
              }}
            >
              {memoBusy ? "Generating..." : "Deal memo"}
            </button>
          </div>
        </div>

        {score ? (
          <div className="alert ok">
            <div>
              <b>Close probability:</b> {score.close_probability}%
            </div>
            {score.rationale?.length ? <div className="muted">{score.rationale.join(" ")}</div> : null}
          </div>
        ) : null}

        {report ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="cardTitle">Investment report</div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{report.content}</pre>
          </div>
        ) : null}

        {memo ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="cardTitle">Deal memo</div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{memo.content}</pre>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div className="cardTitle" style={{ marginBottom: 0 }}>Recent governance feed</div>
          {auditRows.length > 1 ? (
            <button className="btn ghost" type="button" onClick={() => setGovernanceExpanded((value) => !value)}>
              {governanceExpanded ? "Show less" : `Show all ${auditRows.length}`}
            </button>
          ) : null}
        </div>
        {auditRows.length === 0 ? (
          <div className="muted">{publicPreviewMode ? "Upgrade to unlock governance logs, org audit visibility, and support traceability." : "No tracked enterprise actions yet."}</div>
        ) : (
          <div className="list">
            {visibleGovernanceRows.map((item) => (
              <div key={item.id} className="listItem">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div><b>{item.readable_summary || item.summary}</b></div>
                    <div className="muted small">
                      {item.kind}
                      {item.target_email ? ` • target: ${item.target_email}` : ""}
                    </div>
                    {item.detail ? <div className="muted small">{item.detail}</div> : null}
                  </div>
                  <div className="muted small">{fmtDt(item.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
        </>
      ) : null}

      {upgradePrompt ? (
        <aside className="upgradePrompt" aria-live="polite">
          <button className="upgradePromptClose" type="button" onClick={() => setUpgradePrompt(null)} aria-label="Close upgrade prompt">
            ×
          </button>
          <div className="tutorialEyebrow">Subscription Locked</div>
          <div className="upgradePromptTitle">{upgradePrompt.title}</div>
          <div className="upgradePromptText">{upgradePrompt.message}</div>
          <div className="upgradePromptActions">
            <button className="btn ghost" type="button" onClick={() => setUpgradePrompt(null)}>
              Keep exploring
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setUpgradePrompt(null);
                window.location.href = "/account";
              }}
            >
              Upgrade to {upgradePrompt.targetPlan === "builder" ? "Builder" : "Enterprise"}
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
