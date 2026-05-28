// MODIFIED: Phase 3 — Admin subscriber data table — Adds paying-user subscription, payment, usage, health, actions, filters, sorting, bulk selection, and CSV export.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

type SubscriberRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  company_name: string;
  city_state: string;
  plan_name: string;
  plan_price: number;
  billing_cycle: string;
  subscription_start_date: string | null;
  next_renewal_date: string | null;
  days_until_renewal: number;
  subscription_status: "Active" | "Expiring Soon" | "Expired" | "Cancelled";
  total_amount_paid: number;
  last_payment_date: string | null;
  last_payment_amount: number;
  payment_method: string;
  payment_status: "Paid" | "Pending" | "Failed";
  successful_payments: number;
  failed_payments: number;
  last_login_date: string | null;
  login_frequency: "Daily" | "Weekly" | "Rarely" | "Never";
  features_used: string[];
  deals_created: number;
  contacts_added: number;
  tasks_completed: number;
  storage_used: string;
  api_calls_this_month: number;
  health_score: number;
  health_label: "At Risk" | "Stable" | "Power User";
};

type SubscriberResponse = {
  summary: {
    total_subscribers: number;
    active: number;
    expiring_in_7_days: number;
    churned_this_month: number;
    mrr: number;
    collection_rate: number;
  };
  rows: SubscriberRow[];
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function fmtDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN");
}

function exportRows(rows: SubscriberRow[], filename: string) {
  const headers = [
    "full_name", "email", "phone", "company_name", "city_state", "plan_name", "plan_price", "billing_cycle", "subscription_status",
    "days_until_renewal", "total_amount_paid", "payment_status", "successful_payments", "failed_payments", "login_frequency",
    "features_used", "deals_created", "contacts_added", "tasks_completed", "api_calls_this_month", "health_score", "health_label"
  ];
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => JSON.stringify((row as unknown as Record<string, unknown>)[header] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SubscriberDataTable() {
  const [data, setData] = useState<SubscriberResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("all");
  const [status, setStatus] = useState("all");
  const [health, setHealth] = useState("all");
  const [renewal, setRenewal] = useState("all");
  const [sortKey, setSortKey] = useState<keyof SubscriberRow>("days_until_renewal");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [profile, setProfile] = useState<SubscriberRow | null>(null);
  const [emailTarget, setEmailTarget] = useState<SubscriberRow | null>(null);
  const [emailDraft, setEmailDraft] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api<SubscriberResponse>("/admin/subscribers"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subscribers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows || [])
      .filter((row) => !q || [row.full_name, row.email, row.company_name].some((value) => value.toLowerCase().includes(q)))
      .filter((row) => plan === "all" || row.plan_name.toLowerCase() === plan)
      .filter((row) => status === "all" || row.subscription_status.toLowerCase().replace(" ", "_") === status)
      .filter((row) => health === "all" || row.health_label.toLowerCase().replace(" ", "_") === health)
      .filter((row) => renewal === "all" || (renewal === "7d" ? row.days_until_renewal < 7 : row.days_until_renewal <= 30))
      .sort((a, b) => String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""), undefined, { numeric: true }));
  }, [data, health, plan, query, renewal, sortKey, status]);

  const selectedRows = rows.filter((row) => selected[row.id]);

  async function runAction(row: SubscriberRow, action: "extend" | "cancel" | "upgrade" | "note") {
    if (action === "extend") {
      const days = Number(window.prompt("Extend by how many days?", "30") || "30");
      await api(`/admin/subscribers/${row.id}/extend`, { method: "POST", body: JSON.stringify({ days }) });
    }
    if (action === "cancel") {
      await api(`/admin/subscribers/${row.id}/cancel`, { method: "POST" });
    }
    if (action === "upgrade") {
      const nextPlan = window.prompt("Upgrade/change plan to free, enterprise, or builder", row.plan_name === "Builder" ? "enterprise" : "builder") || "enterprise";
      await api(`/admin/subscribers/${row.id}/upgrade`, { method: "POST", body: JSON.stringify({ plan: nextPlan }) });
    }
    if (action === "note") {
      const note = window.prompt("Add admin note", "");
      if (!note) return;
      await api(`/admin/subscribers/${row.id}/note`, { method: "POST", body: JSON.stringify({ note }) });
    }
    await load();
  }

  return (
    <section className="card premiumPanel subscriberSection" id="admin-subscriptions">
      <div className="adminSectionHeader">
        <div>
          <div className="cardTitle">Subscriber Data Panel</div>
          <div className="muted small">Single source of truth for paying user status, payment health, product engagement, and churn risk.</div>
        </div>
        <div className="adminFilters">
          <button className="btn ghost" type="button" onClick={() => void load()}>{loading ? "Loading..." : "Refresh"}</button>
          <button className="btn" type="button" onClick={() => exportRows(rows, "northstone-subscribers.csv")}>Export CSV</button>
        </div>
      </div>
      {error ? <div className="alert">{error}</div> : null}
      {data ? (
        <>
          <div className="summaryStrip">
            <span>Total Subscribers <b>{data.summary.total_subscribers}</b></span>
            <span>Active <b>{data.summary.active}</b></span>
            <span>Expiring in 7 days <b>{data.summary.expiring_in_7_days}</b></span>
            <span>Churned This Month <b>{data.summary.churned_this_month}</b></span>
            <span>MRR <b>{inr.format(data.summary.mrr)}</b></span>
            <span>Collection Rate <b>{data.summary.collection_rate}%</b></span>
          </div>
          <div className="adminFilters left">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, company" aria-label="Search subscribers" />
            <select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="all">All plans</option><option value="starter">Starter</option><option value="growth">Growth</option><option value="builder">Builder</option></select>
            <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All status</option><option value="active">Active</option><option value="expiring_soon">Expiring Soon</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select>
            <select value={health} onChange={(e) => setHealth(e.target.value)}><option value="all">All health</option><option value="at_risk">At Risk</option><option value="stable">Stable</option><option value="power_user">Power User</option></select>
            <select value={renewal} onChange={(e) => setRenewal(e.target.value)}><option value="all">All renewals</option><option value="7d">Renewal &lt; 7d</option><option value="30d">Renewal &lt; 30d</option></select>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as keyof SubscriberRow)}><option value="days_until_renewal">Sort renewal</option><option value="health_score">Sort health</option><option value="total_amount_paid">Sort paid</option><option value="last_login_date">Sort login</option></select>
            <button className="btn ghost" type="button" onClick={() => exportRows(selectedRows.length ? selectedRows : rows, "northstone-selected-subscribers.csv")}>Export selected</button>
            <button className="btn ghost" type="button" onClick={() => setEmailTarget(selectedRows[0] || rows[0] || null)}>Bulk email</button>
            <button className="btn ghost" type="button" onClick={() => selectedRows.forEach((row) => void runAction(row, "note"))}>Flag follow-up</button>
          </div>
          <div className="tableWrap subscriberTable">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" checked={rows.length > 0 && rows.every((row) => selected[row.id])} onChange={(e) => setSelected(Object.fromEntries(rows.map((row) => [row.id, e.target.checked])))} aria-label="Select all subscribers" /></th>
                  <th>Full Name</th><th>Email</th><th>Phone</th><th>Company</th><th>City / State</th><th>Plan</th><th>Price</th><th>Cycle</th><th>Start</th><th>Renewal</th><th>Days</th><th>Status</th><th>Total Paid</th><th>Last Payment</th><th>Method</th><th>Payment</th><th>Success</th><th>Failed</th><th>Last Login</th><th>Frequency</th><th>Features</th><th>Deals</th><th>Contacts</th><th>Tasks</th><th>Storage</th><th>API Calls</th><th>Health</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><input type="checkbox" checked={Boolean(selected[row.id])} onChange={(e) => setSelected((prev) => ({ ...prev, [row.id]: e.target.checked }))} aria-label={`Select ${row.email}`} /></td>
                    <td className="tdTitle">{row.full_name || "-"}</td><td>{row.email}</td><td>{row.phone || "-"}</td><td>{row.company_name || "-"}</td><td>{row.city_state || "-"}</td><td>{row.plan_name}</td><td>{inr.format(row.plan_price)}</td><td>{row.billing_cycle}</td><td>{fmtDate(row.subscription_start_date)}</td><td>{fmtDate(row.next_renewal_date)}</td><td className={row.days_until_renewal < 7 ? "dangerText" : ""}>{row.days_until_renewal}</td><td><span className={`statusPill ${row.subscription_status.toLowerCase().replace(" ", "")}`}>{row.subscription_status}</span></td><td>{inr.format(row.total_amount_paid)}</td><td>{fmtDate(row.last_payment_date)} / {inr.format(row.last_payment_amount)}</td><td>{row.payment_method}</td><td>{row.payment_status}</td><td>{row.successful_payments}</td><td className={row.failed_payments > 1 ? "dangerText" : ""}>{row.failed_payments}</td><td>{fmtDate(row.last_login_date)}</td><td>{row.login_frequency}</td><td>{row.features_used.join(", ") || "-"}</td><td>{row.deals_created}</td><td>{row.contacts_added}</td><td>{row.tasks_completed}</td><td>{row.storage_used}</td><td>{row.api_calls_this_month}</td><td><span className={`healthPill ${row.health_label.toLowerCase().replace(" ", "")}`}>{row.health_score}/10 · {row.health_label}</span></td>
                    <td className="actionCell">
                      <button className="btn ghost compact" type="button" onClick={() => setProfile(row)}>View</button>
                      <button className="btn ghost compact" type="button" onClick={() => setEmailTarget(row)}>Email</button>
                      <button className="btn ghost compact" type="button" onClick={() => void runAction(row, "extend")}>Extend</button>
                      <button className="btn ghost compact" type="button" onClick={() => void runAction(row, "cancel")}>Cancel</button>
                      <button className="btn ghost compact" type="button" onClick={() => void runAction(row, "upgrade")}>Upgrade</button>
                      <button className="btn ghost compact" type="button" onClick={() => void runAction(row, "note")}>Note</button>
                    </td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={29} className="muted">No subscribers match these filters.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : loading ? <div className="muted">Loading subscribers...</div> : null}
      {profile ? (
        <div className="inlineModal">
          <div className="card">
            <div className="row right"><button className="btn ghost compact" type="button" onClick={() => setProfile(null)}>Close</button></div>
            <div className="cardTitle">{profile.full_name || profile.email}</div>
            <p className="muted">Plan: {profile.plan_name} · Status: {profile.subscription_status} · Health: {profile.health_score}/10 {profile.health_label}</p>
            <p className="muted">Company: {profile.company_name || "-"} · City: {profile.city_state || "-"} · Phone: {profile.phone || "-"}</p>
            <p className="muted">Features used: {profile.features_used.join(", ") || "-"}</p>
          </div>
        </div>
      ) : null}
      {emailTarget ? (
        <div className="inlineModal">
          <div className="card">
            <div className="row right"><button className="btn ghost compact" type="button" onClick={() => setEmailTarget(null)}>Close</button></div>
            <div className="cardTitle">Send Email</div>
            <p className="muted small">Compose for {emailTarget.email}. This opens your email client.</p>
            <textarea value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder="Message..." />
            <a className="btn" href={`mailto:${emailTarget.email}?subject=${encodeURIComponent("Northstone subscription update")}&body=${encodeURIComponent(emailDraft)}`}>Open email</a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
