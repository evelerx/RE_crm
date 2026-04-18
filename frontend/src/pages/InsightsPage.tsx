import { useEffect, useState } from "react";
import { api } from "../api/client";

type StageSummary = { stage: string; count: number };

type InsightsSummary = {
  now: string;
  total_deals: number;
  closed_deals: number;
  lost_deals: number;
  win_rate: number | null;
  stuck_deals: number;
  overdue_reminders: number;
  upcoming_reminders_3d: number;
  activities_7d: number;
  completed_activities_7d: number;
  followup_completion_rate_7d: number | null;
  open_pipeline_value: number;
  weighted_open_pipeline_value: number;
  avg_close_probability_open: number | null;
  lead_to_close_rate: number | null;
  visit_to_negotiation_rate: number | null;
  transitions_window_days: number;
  top_transitions: { from: string; to: string; count: number }[];
  team_breakdown: { user_id: string; email: string; full_name: string; role_label: string; deals: number; closed_deals: number; activities_7d: number; open_pipeline_value: number }[];
  recent_audit: { kind: string; summary: string; detail: string; created_at: string }[];
};

function pct(v: number | null) {
  if (v == null) return "-";
  return `${Math.round(v * 100)}%`;
}

function money(v: number | null) {
  if (v == null) return "-";
  return `Rs ${Math.round(v).toLocaleString()}`;
}

export default function InsightsPage() {
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [stages, setStages] = useState<StageSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [s, st] = await Promise.all([
        api<InsightsSummary>("/insights/summary?stuck_days=7&window_days=30"),
        api<StageSummary[]>("/deals/stages/summary")
      ]);
      setSummary(s);
      setStages(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load insights");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Insights</div>
          <div className="muted">Manager view for pipeline value, conversion momentum, and execution discipline.</div>
        </div>
        <button className="btn ghost" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      {summary ? (
        <div className="detailGrid">
          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="cardTitle">Revenue view</div>
            <div className="statsGrid">
              <div className="statCard">
                <div className="statLabel">Open pipeline</div>
                <div className="statValue">{money(summary.open_pipeline_value)}</div>
                <div className="statHint">Live value still being worked by the team.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Weighted pipeline</div>
                <div className="statValue">{money(summary.weighted_open_pipeline_value)}</div>
                <div className="statHint">Risk-adjusted pipeline based on current close probability.</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Follow-up completion</div>
                <div className="statValue">{pct(summary.followup_completion_rate_7d)}</div>
                <div className="statHint">
                  {summary.completed_activities_7d} completed out of {summary.activities_7d} activities in the last 7 days.
                </div>
              </div>
              <div className="statCard">
                <div className="statLabel">Avg close probability</div>
                <div className="statValue">
                  {summary.avg_close_probability_open == null ? "-" : `${Math.round(summary.avg_close_probability_open)}%`}
                </div>
                <div className="statHint">Average confidence across all open deals.</div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="cardTitle">KPI</div>
            <div className="kv">
              <div className="k">Deals</div>
              <div className="v">{summary.total_deals}</div>
              <div className="k">Win rate</div>
              <div className="v">{pct(summary.win_rate)}</div>
              <div className="k">Stuck (7d)</div>
              <div className="v">{summary.stuck_deals}</div>
              <div className="k">Overdue</div>
              <div className="v">{summary.overdue_reminders}</div>
              <div className="k">Upcoming (3d)</div>
              <div className="v">{summary.upcoming_reminders_3d}</div>
              <div className="k">Activities (7d)</div>
              <div className="v">{summary.activities_7d}</div>
              <div className="k">Lead to close</div>
              <div className="v">{pct(summary.lead_to_close_rate)}</div>
              <div className="k">Visit to negotiation</div>
              <div className="v">{pct(summary.visit_to_negotiation_rate)}</div>
            </div>
          </section>

          <section className="card">
            <div className="cardTitle">Pipeline</div>
            <div className="kv">
              {stages.map((s) => (
                <div key={s.stage} className="row" style={{ justifyContent: "space-between" }}>
                  <div className="k" style={{ width: 140, textTransform: "capitalize" }}>
                    {s.stage}
                  </div>
                  <div className="v">{s.count}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="cardTitle">Top stage moves (30 days)</div>
            {summary.top_transitions.length === 0 ? (
              <div className="muted">No stage changes tracked yet.</div>
            ) : (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>From</th>
                      <th>To</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.top_transitions.map((t) => (
                      <tr key={`${t.from}-${t.to}`}>
                        <td style={{ textTransform: "capitalize" }}>{t.from || "-"}</td>
                        <td style={{ textTransform: "capitalize" }}>{t.to || "-"}</td>
                        <td>{t.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="cardTitle">Team leaderboard</div>
            {summary.team_breakdown.length === 0 ? (
              <div className="muted">Team leaderboard appears for enterprise owners once employee IDs start working deals.</div>
            ) : (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Deals</th>
                      <th>Closed</th>
                      <th>Activities (7d)</th>
                      <th>Open pipeline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.team_breakdown.map((member) => (
                      <tr key={member.user_id}>
                        <td className="tdTitle">{member.full_name || "-"}</td>
                        <td>{member.email}</td>
                        <td>{member.role_label}</td>
                        <td>{member.deals}</td>
                        <td>{member.closed_deals}</td>
                        <td>{member.activities_7d}</td>
                        <td>{money(member.open_pipeline_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="cardTitle">Recent audit feed</div>
            {summary.recent_audit.length === 0 ? (
              <div className="muted">No tracked actions yet.</div>
            ) : (
              <div className="list">
                {summary.recent_audit.map((item, idx) => (
                  <div key={`${item.kind}-${item.created_at}-${idx}`} className="listItem">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div>
                        <div><b>{item.summary}</b></div>
                        {item.detail ? <div className="muted small">{item.detail}</div> : null}
                      </div>
                      <div className="muted small">{new Date(item.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="muted">Loading...</div>
      )}
    </div>
  );
}
