import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Profile } from "../api/types";

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
  counts: { deals: number; contacts: number; activities: number };
};

type EnterpriseOverview = {
  enterprise_owner_id: string;
  owner_email: string;
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

export default function EnterprisePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<EnterpriseOverview | null>(null);
  const [companyProfile, setCompanyProfile] = useState<Profile | null>(null);
  const [market, setMarket] = useState<MarketInsightsResponse | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioAnalyticsResponse | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [chatRows, setChatRows] = useState<SupportChatRow[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [compactAvgTicket, setCompactAvgTicket] = useState(true);

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

  const dealOptions = useMemo(() => deals.map((d) => ({ value: d.id, label: `${d.title} (${d.stage})` })), [deals]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [o, profile, marketResp, portfolioResp, dealsResp, auditResp, chatResp] = await Promise.all([
        api<EnterpriseOverview>("/enterprise/overview"),
        api<Profile>("/profile"),
        api<MarketInsightsResponse>("/enterprise/market-insights?window_days=90"),
        api<PortfolioAnalyticsResponse>("/enterprise/portfolio/analytics?window_days=365"),
        api<DealRow[]>("/deals"),
        api<AuditRow[]>("/enterprise/audit?limit=20"),
        api<SupportChatRow[]>("/enterprise/support-chat")
      ]);
      setOverview(o);
      setCompanyProfile(profile);
      setMarket(marketResp);
      setPortfolio(portfolioResp);
      setDeals(dealsResp);
      setAuditRows(auditResp);
      setChatRows(chatResp);
      if (!dealId && dealsResp.length) setDealId(dealsResp[0].id);
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

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Enterprise</div>
          <div className="muted">Team management and rollups.</div>
        </div>
        <button className="btn ghost" onClick={() => void load()} type="button">
          Refresh
        </button>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="muted">Loading...</div> : null}

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
        ) : (
          <div className="muted">No enterprise overview yet.</div>
        )}
      </section>

      <section className="card">
        <div className="cardTitle">Enterprise company setup</div>
        <div className="muted">
          Complete these safe public company details before enterprise features unlock. Sensitive items like PAN, GSTIN, and private compliance data are not shown here.
        </div>
        {companyProfile ? (
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
            {!companySetupComplete ? <div className="alert">Complete company name, city, areas served, specialization, and public summary to unlock enterprise features.</div> : null}
            <button className="btn" type="submit" disabled={companyBusy}>
              {companyBusy ? "Saving..." : "Save company details"}
            </button>
          </form>
        ) : (
          <div className="muted">Loading company profile...</div>
        )}
      </section>

      {!companySetupComplete ? (
        <section className="card">
          <div className="cardTitle">Enterprise features locked</div>
          <div className="muted">
            Finish the enterprise company setup above first. After that, employee management, analytics, reports, and other enterprise tools will unlock.
          </div>
        </section>
      ) : null}

      {companySetupComplete ? (
        <>
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
                  <td>{employee.counts.contacts}</td>
                  <td>{employee.counts.activities}</td>
                  <td>{fmtDt(employee.created_at)}</td>
                  <td>
                    <div className="row">
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
                    </div>
                  </td>
                </tr>
              ))}
              {!overview?.employees.length && !loading ? (
                <tr>
                  <td colSpan={10} className="muted">
                    No employee IDs created yet.
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
        <div className="chatList">
          {chatRows.length === 0 ? <div className="muted">No conversation yet.</div> : null}
          {chatRows.map((item) => (
            <div key={item.id} className={`chatBubble ${item.sender_role === "enterprise_owner" ? "chatBubbleAdmin" : ""}`}>
              <div className="chatMeta">
                <b>{item.sender_role === "admin" ? "Admin" : "You"}</b>
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
          <div className="muted">No analytics yet.</div>
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
          <div className="muted">Add deals with city, area, and ticket size to see trends.</div>
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
              disabled={!dealId || scoreBusy}
              onClick={async () => {
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
              disabled={!dealId || reportBusy}
              onClick={async () => {
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
              disabled={!dealId || memoBusy}
              onClick={async () => {
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
        <div className="cardTitle">Recent governance feed</div>
        {auditRows.length === 0 ? (
          <div className="muted">No tracked enterprise actions yet.</div>
        ) : (
          <div className="list">
            {auditRows.map((item) => (
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
    </div>
  );
}
