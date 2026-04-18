import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import type { Activity, Contact, Deal } from "../api/types";

type NextActionsResponse = {
  now: string;
  overdue: Activity[];
  upcoming: Activity[];
  stuck_deals: Deal[];
};

type SalesSummary = {
  open_pipeline_value: number;
  weighted_open_pipeline_value: number;
  followup_completion_rate_7d: number | null;
  win_rate: number | null;
  overdue_reminders: number;
};

function normalizeWhatsAppNumber(value: string | null | undefined) {
  const digits = (value || "").replace(/\D+/g, "");
  if (digits.length < 10) return "";
  return digits;
}

function openWhatsApp(message: string, phone: string | null | undefined) {
  const target = normalizeWhatsAppNumber(phone);
  if (!target) {
    throw new Error("Linked contact needs a valid phone or WhatsApp number before sending.");
  }
  const url = `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

function money(v: number | null) {
  if (v == null) return "-";
  return `Rs ${Math.round(v).toLocaleString()}`;
}

function pct(v: number | null) {
  if (v == null) return "-";
  return `${Math.round(v * 100)}%`;
}

async function generateFollowup(deal: Deal): Promise<string> {
  try {
    const resp = await api<{ deal_id: string; message: string }>("/ai/llm/followup", {
      method: "POST",
      body: JSON.stringify({
        provider: "openrouter",
        deal_id: deal.id,
        objective: "followup",
        channel: "whatsapp",
        tone: "professional"
      })
    });
    return resp.message;
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 400 && e.status !== 404)) throw e;
  }
  const resp = await api<{ deal_id: string; message: string }>("/ai/followup", {
    method: "POST",
    body: JSON.stringify({ deal_id: deal.id, objective: "followup", channel: "whatsapp", tone: "professional" })
  });
  return resp.message;
}

export default function TodayPage() {
  const [data, setData] = useState<NextActionsResponse | null>(null);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyActId, setBusyActId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [actions, insights, contactRows] = await Promise.all([
        api<NextActionsResponse>("/next-actions?days=3&stuck_days=7"),
        api<SalesSummary>("/insights/summary?stuck_days=7&window_days=30"),
        api<Contact[]>("/contacts")
      ]);
      setData(actions);
      setSalesSummary(insights);
      setContacts(contactRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load next actions");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const overdue = data?.overdue ?? [];
  const upcoming = data?.upcoming ?? [];
  const stuck = data?.stuck_deals ?? [];

  const title = useMemo(() => {
    const o = overdue.length;
    const u = upcoming.length;
    if (o) return `Today (${o} overdue)`;
    if (u) return `Today (${u} upcoming)`;
    return "Today";
  }, [overdue.length, upcoming.length]);

  function formatDue(a: Activity) {
    if (!a.due_at) return "-";
    return new Date(a.due_at).toLocaleString();
  }

  async function markDone(a: Activity) {
    setBusyActId(a.id);
    try {
      const updated = await api<Activity>(`/activities/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: true })
      });
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          overdue: prev.overdue.filter((x) => x.id !== updated.id),
          upcoming: prev.upcoming.filter((x) => x.id !== updated.id)
        };
      });
    } finally {
      setBusyActId(null);
    }
  }

  async function snooze1d(a: Activity) {
    setBusyActId(a.id);
    try {
      const base = a.due_at ? new Date(a.due_at) : new Date();
      const due = new Date(base.getTime() + 24 * 60 * 60 * 1000);
      const updated = await api<Activity>(`/activities/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ due_at: due.toISOString() })
      });
      setData((prev) => {
        if (!prev) return prev;
        const remove = (xs: Activity[]) => xs.filter((x) => x.id !== updated.id);
        return { ...prev, overdue: remove(prev.overdue), upcoming: [updated, ...remove(prev.upcoming)] };
      });
    } finally {
      setBusyActId(null);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">{title}</div>
          <div className="muted">Daily priorities and follow-ups.</div>
        </div>
        <button className="btn ghost" onClick={() => void load()} type="button">
          Refresh
        </button>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      {salesSummary ? (
        <section className="card">
          <div className="cardTitle">Sales snapshot</div>
          <div className="statsGrid">
            <div className="statCard">
              <div className="statLabel">Open pipeline</div>
              <div className="statValue">{money(salesSummary.open_pipeline_value)}</div>
              <div className="statHint">Current pipeline value.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Weighted pipeline</div>
              <div className="statValue">{money(salesSummary.weighted_open_pipeline_value)}</div>
              <div className="statHint">Probability-adjusted forecast.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Follow-up discipline</div>
              <div className="statValue">{pct(salesSummary.followup_completion_rate_7d)}</div>
              <div className="statHint">7-day completion rate.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Win rate</div>
              <div className="statValue">{pct(salesSummary.win_rate)}</div>
              <div className="statHint">{salesSummary.overdue_reminders} overdue reminders need attention.</div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="cardTitle">Overdue</div>
        {overdue.length === 0 ? <div className="muted">Nothing overdue.</div> : null}
        <div className="list">
          {overdue.map((a) => (
            <div key={a.id} className="listItem">
              <div className="muted">
                {a.kind} - Due {formatDue(a)}
                {a.deal_id ? (
                  <span>
                    {" "}
                    -{" "}
                    <Link className="link" to={`/deals/${a.deal_id}`}>
                      Open deal
                    </Link>
                  </span>
                ) : null}
              </div>
              <div className="row">
                <div className="grow">{a.summary || "-"}</div>
                <button className="btn" type="button" onClick={() => void markDone(a)} disabled={busyActId === a.id}>
                  {busyActId === a.id ? "Working..." : "Mark done"}
                </button>
                <button className="btn ghost" type="button" onClick={() => void snooze1d(a)} disabled={busyActId === a.id}>
                  Snooze 1d
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="cardTitle">Upcoming (3 days)</div>
        {upcoming.length === 0 ? <div className="muted">No upcoming reminders.</div> : null}
        <div className="list">
          {upcoming.map((a) => (
            <div key={a.id} className="listItem">
              <div className="muted">
                {a.kind} - Due {formatDue(a)}
                {a.deal_id ? (
                  <span>
                    {" "}
                    -{" "}
                    <Link className="link" to={`/deals/${a.deal_id}`}>
                      Open deal
                    </Link>
                  </span>
                ) : null}
              </div>
              <div className="row">
                <div className="grow">{a.summary || "-"}</div>
                <button className="btn ghost" type="button" onClick={() => void markDone(a)} disabled={busyActId === a.id}>
                  {busyActId === a.id ? "Working..." : "Done"}
                </button>
                <button className="btn ghost" type="button" onClick={() => void snooze1d(a)} disabled={busyActId === a.id}>
                  Snooze 1d
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="cardTitle">Stuck deals (no activity 7+ days)</div>
        {stuck.length === 0 ? <div className="muted">No stuck deals.</div> : null}
        <div className="list">
          {stuck.map((d) => (
            <div key={d.id} className="listItem">
              {(() => {
                const linkedContact = contacts.find((contact) => contact.id === (d.contact_id || ""));
                const linkedPhone = linkedContact?.phone;
                const canSendWhatsApp = Boolean(normalizeWhatsAppNumber(linkedPhone));
                return (
                  <>
              <div className="muted">
                {d.asset_type} - {d.stage} - {d.area}
                {d.city ? `, ${d.city}` : ""}
              </div>
              <div className="row">
                <div className="grow">
                  <b>{d.title}</b>
                </div>
                <Link className="btn ghost" to={`/deals/${d.id}`}>
                  Open
                </Link>
                <button
                  className="btn"
                  type="button"
                  disabled={busyId === d.id || !canSendWhatsApp}
                  onClick={async () => {
                    setBusyId(d.id);
                    try {
                      const msg = await generateFollowup(d);
                      openWhatsApp(msg, linkedPhone);
                      await api<Activity>("/activities", {
                        method: "POST",
                        body: JSON.stringify({ deal_id: d.id, kind: "whatsapp", summary: "WhatsApp follow-up generated/sent" })
                      });
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "WhatsApp follow-up failed");
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  {busyId === d.id ? "Generating..." : "WhatsApp follow-up"}
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={busyId === d.id}
                  onClick={async () => {
                    setBusyId(d.id);
                    try {
                      const due = new Date(Date.now() + 24 * 60 * 60 * 1000);
                      await api<Activity>("/activities", {
                        method: "POST",
                        body: JSON.stringify({
                          deal_id: d.id,
                          kind: "call",
                          summary: "Follow up tomorrow",
                          due_at: due.toISOString()
                        })
                      });
                      await load();
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  Remind tomorrow
                </button>
              </div>
              {!canSendWhatsApp ? <div className="muted small">Link this deal to a contact with a valid phone number to send on WhatsApp.</div> : null}
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
