// MODIFIED: Enterprise sidebar wiring — Replaces the dead Automations placeholder with a live workspace backed by /next-actions so owners can act on overdue activities and stuck deals.
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";

type ActivityRow = {
  id: string;
  summary: string;
  kind: string;
  due_at: string | null;
  completed: boolean;
  deal_id: string | null;
  contact_id: string | null;
};

type StuckDealRow = {
  id: string;
  title: string;
  stage: string;
  city: string;
  area: string;
  updated_at: string;
  last_activity_at: string | null;
};

type NextActionsResponse = {
  now: string;
  overdue: ActivityRow[];
  upcoming: ActivityRow[];
  stuck_deals: StuckDealRow[];
};

function fmtDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function AutomationsPage() {
  const [data, setData] = useState<NextActionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const nextActions = await api<NextActionsResponse>("/next-actions?days=5&stuck_days=7");
      setData(nextActions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load automations workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const summary = useMemo(() => ({
    overdue: data?.overdue.length ?? 0,
    upcoming: data?.upcoming.length ?? 0,
    stuck: data?.stuck_deals.length ?? 0,
  }), [data]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Automations</div>
          <div className="muted">Monitor overdue tasks, upcoming actions, and stuck deals from one operational view.</div>
        </div>
        <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <div className="alert err">{error}</div> : null}

      <section className="inventoryGrid">
        <div className="card card-pad">
          <div className="cardTitle">Overdue actions</div>
          <div className="h1" style={{ fontSize: "2rem" }}>{summary.overdue}</div>
          <div className="muted">Tasks that should already be completed.</div>
        </div>
        <div className="card card-pad">
          <div className="cardTitle">Due soon</div>
          <div className="h1" style={{ fontSize: "2rem" }}>{summary.upcoming}</div>
          <div className="muted">Activities due in the next five days.</div>
        </div>
        <div className="card card-pad">
          <div className="cardTitle">Stuck deals</div>
          <div className="h1" style={{ fontSize: "2rem" }}>{summary.stuck}</div>
          <div className="muted">Open deals with no meaningful movement in the last week.</div>
        </div>
      </section>

      <div className="sequenceBuilderLayout">
        <section className="card card-pad">
          <div className="cardTitle">Overdue + upcoming activities</div>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Summary</th>
                  <th>Type</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="muted">Loading workflow queue...</td>
                  </tr>
                ) : [...(data?.overdue ?? []), ...(data?.upcoming ?? [])].length ? (
                  [...(data?.overdue ?? []), ...(data?.upcoming ?? [])].map((activity) => {
                    const overdue = Boolean(activity.due_at && new Date(activity.due_at).getTime() < Date.now());
                    return (
                      <tr key={activity.id}>
                        <td className="tdTitle">{activity.summary || "Untitled activity"}</td>
                        <td>{activity.kind || "-"}</td>
                        <td>{fmtDate(activity.due_at)}</td>
                        <td>{overdue ? "Overdue" : "Scheduled"}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="muted">No pending automation items right now.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card card-pad">
          <div className="cardTitle">Stuck deals needing intervention</div>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Stage</th>
                  <th>Location</th>
                  <th>Last touched</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="muted">Loading deal signals...</td>
                  </tr>
                ) : data?.stuck_deals.length ? (
                  data.stuck_deals.map((deal) => (
                    <tr key={deal.id}>
                      <td className="tdTitle">{deal.title}</td>
                      <td>{deal.stage}</td>
                      <td>{[deal.area, deal.city].filter(Boolean).join(", ") || "-"}</td>
                      <td>{fmtDate(deal.last_activity_at || deal.updated_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="muted">No stuck deals. This queue is clear.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
