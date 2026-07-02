import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  agencyMe,
  agencyManagerDashboard,
  agencyManagerRequests,
  agencyManagerRequestDetail,
  agencyManagerUpdateStatus,
  agencyManagerComment,
  agencyExecutiveDashboard,
  agencyExecutiveTasks,
  type AgencyLoginResponse,
  type AgencyDashboard,
} from "../api/client";
import { clearAgencySession } from "../auth";
import type { MarketingRequestSummary, MarketingRequestDetail } from "../types/marketing";

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function statusBadgeClass(status: string) {
  if (["completed", "agency_approved"].includes(status)) return "adminPill";
  if (["submitted", "under_review", "agency_review"].includes(status)) return "";
  return "";
}

function ManagerDashboard({ user }: { user: AgencyLoginResponse["user"] }) {
  const [dashboard, setDashboard] = useState<AgencyDashboard | null>(null);
  const [requests, setRequests] = useState<MarketingRequestSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MarketingRequestDetail | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyManagerDashboard().then(setDashboard).catch((e) => setError(e.message));
    agencyManagerRequests().then(setRequests).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    agencyManagerRequestDetail(selectedId).then(setDetail).catch((e) => setError(e.message));
  }, [selectedId]);

  const filteredRequests = statusFilter ? requests.filter((r) => r.status === statusFilter) : requests;

  async function handleStatusUpdate(status: string) {
    if (!selectedId) return;
    setSending(true);
    try {
      const updated = await agencyManagerUpdateStatus(selectedId, status);
      setDetail(updated);
      setRequests((prev) => prev.map((r) => r.id === selectedId ? { ...r, status: updated.status } : r));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setSending(false); }
  }

  async function handleComment() {
    if (!selectedId || !commentDraft.trim()) return;
    setSending(true);
    try {
      const comment = await agencyManagerComment(selectedId, commentDraft.trim());
      setDetail((prev) => prev ? { ...prev, comments: [...(prev.comments || []), comment] } : prev);
      setCommentDraft("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setSending(false); }
  }

  return (
    <div className="page" style={{ display: "flex", gap: 0, flexDirection: "column" }}>
      <div className="pageHeader">
        <div>
          <div className="h1">Marketing Portal — Manager</div>
          <div className="muted">Welcome, {user.name || user.email}</div>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      {dashboard ? (
        <div className="statsGrid" style={{ marginBottom: 20 }}>
          {[
            { label: "Total requests", value: dashboard.total_requests },
            { label: "Pending review", value: dashboard.pending_review },
            { label: "In progress", value: dashboard.in_progress },
            { label: "Completed (month)", value: dashboard.completed_this_month },
            { label: "Tasks overdue", value: dashboard.tasks_overdue },
          ].map((kpi) => (
            <div key={kpi.label} className="statCard">
              <div className="statLabel">{kpi.label}</div>
              <div className="statValue">{kpi.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, flex: 1 }}>
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <div className="cardTitle">Requests</div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ fontSize: 12, padding: "4px 8px" }}>
              <option value="">All</option>
              <option value="submitted">Submitted</option>
              <option value="agency_review">In review</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="list">
            {filteredRequests.length === 0 ? <div className="muted small">No requests yet.</div> : null}
            {filteredRequests.map((req) => (
              <button
                key={req.id}
                type="button"
                className={`listItem${selectedId === req.id ? " feedRowNew" : ""}`}
                style={{ textAlign: "left", width: "100%", cursor: "pointer" }}
                onClick={() => setSelectedId(req.id)}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b style={{ fontSize: 13 }}>{req.project_name || req.request_code}</b>
                  <span className={`pill ${statusBadgeClass(req.status)}`} style={{ fontSize: 11 }}>{req.status.replace(/_/g, " ")}</span>
                </div>
                <div className="muted small">{req.channel} · {fmtDate(req.created_at)}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          {!detail ? (
            <div className="emptyStateCard">
              <div className="h2">Select a request</div>
              <div className="muted">Pick a request from the left to view details, update status, or reply.</div>
            </div>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div className="h2">{detail.project_name || detail.request_code}</div>
                  <div className="muted small">{detail.channel} · {detail.objective} · {fmtDate(detail.created_at)}</div>
                </div>
                <span className={`pill ${statusBadgeClass(detail.status)}`}>{detail.status.replace(/_/g, " ")}</span>
              </div>
              <div className="grid2" style={{ marginBottom: 16 }}>
                {[
                  ["City", detail.target_city], ["Area", detail.target_area], ["Budget/mo", `₹${(detail.monthly_spend || 0).toLocaleString("en-IN")}`],
                  ["Objective", detail.objective], ["Duration", detail.duration], ["Lead target", detail.lead_target],
                  ["CTA", detail.cta], ["USP", detail.usp],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="listItem" style={{ padding: "6px 10px" }}>
                    <span className="muted small">{k}: </span><b style={{ fontSize: 13 }}>{v}</b>
                  </div>
                ))}
              </div>
              {detail.notes ? <div className="muted small" style={{ marginBottom: 12 }}>Notes: {detail.notes}</div> : null}

              <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {[
                  { label: "Move to review", status: "agency_review" },
                  { label: "Start work", status: "in_progress" },
                  { label: "Mark approved", status: "agency_approved" },
                  { label: "Mark completed", status: "completed" },
                ].map(({ label, status }) => (
                  <button key={status} className="btn ghost" type="button" disabled={sending} onClick={() => void handleStatusUpdate(status)}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="cardTitle" style={{ marginBottom: 8 }}>Thread</div>
              <div className="list" style={{ maxHeight: 200, overflowY: "auto", marginBottom: 12 }}>
                {(detail.comments || []).length === 0 ? <div className="muted small">No messages yet.</div> : null}
                {(detail.comments || []).map((c) => (
                  <div key={c.id} className={`whatsappBubble ${c.sender_role === "owner" ? "inbound" : "outbound"}`} style={{ maxWidth: "80%" }}>
                    <div className="muted small">{c.sender_name} ({c.sender_role})</div>
                    <div>{c.message}</div>
                    <div className="whatsappBubbleMeta"><span>{fmtDate(c.created_at)}</span></div>
                  </div>
                ))}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder="Reply to owner..."
                  rows={2}
                  style={{ flex: 1 }}
                />
                <button className="btn" type="button" disabled={sending || !commentDraft.trim()} onClick={() => void handleComment()}>
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ExecutiveDashboard({ user }: { user: AgencyLoginResponse["user"] }) {
  const [tasks, setTasks] = useState<unknown[]>([]);
  const [stats, setStats] = useState<{ active_tasks: number; overdue: number; completed_today: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyExecutiveDashboard().then((d) => { setStats(d); setTasks(d.tasks); }).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Marketing Portal — Executive</div>
          <div className="muted">Welcome, {user.name || user.email}</div>
        </div>
      </div>
      {error ? <div className="alert">{error}</div> : null}
      {stats ? (
        <div className="statsGrid">
          <div className="statCard"><div className="statLabel">Active tasks</div><div className="statValue">{stats.active_tasks}</div></div>
          <div className="statCard"><div className="statLabel">Overdue</div><div className="statValue" style={{ color: "#e06464" }}>{stats.overdue}</div></div>
          <div className="statCard"><div className="statLabel">Completed today</div><div className="statValue">{stats.completed_today}</div></div>
        </div>
      ) : null}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="cardTitle">My Tasks</div>
        {tasks.length === 0 ? <div className="muted">No tasks assigned yet.</div> : (
          <div className="list">
            {tasks.map((t: unknown) => {
              const task = t as Record<string, unknown>;
              return (
                <div key={String(task.id)} className="listItem">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <b>{String(task.title || "Task")}</b>
                    <span className="pill">{String(task.status || "pending")}</span>
                  </div>
                  {task.due_date ? <div className="muted small">Due: {fmtDate(String(task.due_date))}</div> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgencyDashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AgencyLoginResponse["user"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyMe()
      .then((res) => setUser(res.user))
      .catch(() => {
        clearAgencySession();
        navigate("/agency/login");
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  function handleLogout() {
    clearAgencySession();
    navigate("/agency/login");
  }

  if (loading) return <div className="page"><div className="muted">Loading...</div></div>;
  if (error) return <div className="page"><div className="alert">{error}</div></div>;
  if (!user) return null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ background: "white", borderBottom: "1px solid var(--border)", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <img src="/northstone-logo-icon.png" alt="Northstone" style={{ width: 32, height: 32 }} />
          <b>Northstone Marketing Portal</b>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <span className="muted small">{user.name || user.email} · <span className="pill">{user.role === "marketing_manager" ? "Manager" : "Executive"}</span></span>
          <button className="btn ghost" type="button" onClick={handleLogout}>Logout</button>
        </div>
      </div>
      <div style={{ padding: 24 }}>
        {user.role === "marketing_manager" ? <ManagerDashboard user={user} /> : <ExecutiveDashboard user={user} />}
      </div>
    </div>
  );
}
