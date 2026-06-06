// MODIFIED: Phase 2 — Admin revenue analytics graphs — Adds KPI cards, combo revenue chart, donut plan split, growth area chart, filters, and CSV export.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "../api/client";

type Grain = "day" | "week" | "month" | "year";

type RevenueTimelinePoint = {
  label: string;
  gross_revenue: number;
  new_revenue: number;
  renewal_revenue: number;
  churned_revenue: number;
  net_revenue: number;
  transactions: number;
  plan_breakdown: { plan: string; amount: number; count: number }[];
};

type RevenuePlanTier = {
  plan: string;
  active_subscribers: number;
  mrr: number;
  arr: number;
  avg_ltv: number;
  percent: number;
};

type RevenueGrowthPoint = {
  label: string;
  total_active: number;
  new_subscribers: number;
  cancelled: number;
  net_growth_rate: number;
};

type RevenueAnalytics = {
  grain: Grain;
  plan_filter: string;
  start_date: string;
  end_date: string;
  kpis: {
    total_mrr: number;
    total_arr: number;
    active_subscribers: number;
    new_this_month: number;
    churned: number;
    avg_revenue_per_user: number;
    changes: Record<string, number>;
  };
  timeline: RevenueTimelinePoint[];
  plan_tiers: RevenuePlanTier[];
  growth: RevenueGrowthPoint[];
  export_rows: Record<string, string | number>[];
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const colors = ["#5f87c6", "#4da08a", "#caa468", "#e06464", "#9b8cff"];

function changeBadge(value: number) {
  const tone = value >= 0 ? "ok" : "danger";
  return <span className={`metricChange ${tone}`}>{value >= 0 ? "↑" : "↓"} {Math.abs(value).toFixed(1)}%</span>;
}

function pointsForLine(values: number[], width: number, height: number) {
  const max = Math.max(1, ...values);
  return values
    .map((value, index) => {
      const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - (value / max) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function downloadCsv(rows: Record<string, string | number>[]) {
  const headers = Object.keys(rows[0] || { period: "", gross_revenue: "", net_revenue: "" });
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "northstone-revenue-analytics.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function RevenueGraph() {
  const [grain, setGrain] = useState<Grain>("month");
  const [plan, setPlan] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState<RevenueAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ grain, plan });
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      setData(await api<RevenueAnalytics>(`/admin/revenue-analytics?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load revenue analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grain, plan, startDate, endDate]);

  const linePoints = useMemo(() => pointsForLine(data?.timeline.map((row) => row.gross_revenue) || [], 520, 180), [data]);
  const growthPoints = useMemo(() => pointsForLine(data?.growth.map((row) => row.total_active) || [], 520, 160), [data]);
  const donut = data?.plan_tiers || [];
  let offset = 0;

  return (
    <section className="card premiumPanel revenueSection" id="admin-revenue">
      <div className="adminSectionHeader">
        <div>
          <div className="cardTitle">Revenue Analytics</div>
          <div className="muted small">Subscription sales revenue, plan mix, renewals, churn, and subscriber growth.</div>
        </div>
        <div className="adminFilters">
          <select value={grain} onChange={(e) => setGrain(e.target.value as Grain)} aria-label="Revenue period">
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
          <select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan filter">
            <option value="all">All plans</option>
            <option value="enterprise">Enterprise</option>
            <option value="builder">Builder</option>
            <option value="solo">Solo</option>
            <option value="free">Free</option>
          </select>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="End date" />
          <button className="btn ghost" type="button" onClick={() => void load()}>{loading ? "Loading..." : "Apply"}</button>
          <button className="btn" type="button" onClick={() => data && downloadCsv(data.export_rows)} disabled={!data}>Export CSV</button>
        </div>
      </div>
      {error ? <div className="alert">{error}</div> : null}
      {data ? (
        <>
          <div className="revenueKpis">
            <div className="statCard"><div className="statLabel">Total MRR</div><div className="statValue">{inr.format(data.kpis.total_mrr)}</div>{changeBadge(data.kpis.changes.total_mrr || 0)}</div>
            <div className="statCard"><div className="statLabel">Total ARR</div><div className="statValue">{inr.format(data.kpis.total_arr)}</div>{changeBadge(data.kpis.changes.total_arr || 0)}</div>
            <div className="statCard"><div className="statLabel">Active Subs</div><div className="statValue">{data.kpis.active_subscribers}</div>{changeBadge(data.kpis.changes.active_subscribers || 0)}</div>
            <div className="statCard"><div className="statLabel">New This Month</div><div className="statValue">+{data.kpis.new_this_month}</div>{changeBadge(data.kpis.changes.new_this_month || 0)}</div>
            <div className="statCard"><div className="statLabel">Churned</div><div className="statValue">-{data.kpis.churned}</div>{changeBadge(data.kpis.changes.churned || 0)}</div>
            <div className="statCard"><div className="statLabel">Avg Revenue / User</div><div className="statValue">{inr.format(data.kpis.avg_revenue_per_user)}</div>{changeBadge(data.kpis.changes.avg_revenue_per_user || 0)}</div>
          </div>
          <div className="revenueCharts">
            <article className="chartCard wide">
              <div className="cardTitle">Subscription Revenue Over Time</div>
              <svg viewBox="0 0 560 240" role="img" aria-label="Revenue line and bar chart">
                <g transform="translate(20 20)">
                  {data.timeline.map((row, index) => {
                    const max = Math.max(1, ...data.timeline.map((point) => point.gross_revenue));
                    const x = data.timeline.length <= 1 ? 240 : (index / (data.timeline.length - 1)) * 500;
                    const barWidth = Math.max(8, 420 / Math.max(1, data.timeline.length));
                    const newHeight = (row.new_revenue / max) * 160;
                    const renewalHeight = (row.renewal_revenue / max) * 160;
                    const churnHeight = (row.churned_revenue / max) * 80;
                    return (
                      <g key={row.label} className="chartPoint">
                        <rect x={x - barWidth / 2} y={180 - newHeight} width={barWidth / 3} height={newHeight} fill="#4da08a" />
                        <rect x={x - barWidth / 6} y={180 - renewalHeight} width={barWidth / 3} height={renewalHeight} fill="#caa468" />
                        <rect x={x + barWidth / 6} y={180} width={barWidth / 3} height={churnHeight} fill="#e06464" />
                        <title>{`${row.label}: Gross ${inr.format(row.gross_revenue)}, New ${inr.format(row.new_revenue)}, Renewals ${inr.format(row.renewal_revenue)}, Churn ${inr.format(row.churned_revenue)}, ${row.transactions} transactions`}</title>
                      </g>
                    );
                  })}
                  <polyline points={linePoints} transform="translate(0 0)" fill="none" stroke="#5f87c6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              </svg>
              <div className="legend"><span className="blue">Total revenue</span><span className="green">New</span><span className="orange">Renewal</span><span className="red">Churn</span></div>
            </article>
            <article className="chartCard">
              <div className="cardTitle">Revenue by Plan Tier</div>
              <svg viewBox="0 0 220 220" className="donutChart" role="img" aria-label="Revenue by plan donut chart">
                <circle cx="110" cy="110" r="72" fill="transparent" stroke="rgba(255,255,255,0.08)" strokeWidth="34" />
                {donut.map((row, index) => {
                  const dash = row.percent * 4.52;
                  const segment = (
                    <circle
                      key={row.plan}
                      cx="110"
                      cy="110"
                      r="72"
                      fill="transparent"
                      stroke={colors[index % colors.length]}
                      strokeWidth="34"
                      strokeDasharray={`${dash} ${452 - dash}`}
                      strokeDashoffset={-offset}
                      transform="rotate(-90 110 110)"
                    >
                      <title>{`${row.plan}: ${row.percent}% / ${inr.format(row.mrr)} MRR`}</title>
                    </circle>
                  );
                  offset += dash;
                  return segment;
                })}
                <text x="110" y="106" textAnchor="middle" fill="currentColor" fontSize="18" fontWeight="800">MRR</text>
                <text x="110" y="128" textAnchor="middle" fill="currentColor" fontSize="12">{inr.format(data.kpis.total_mrr)}</text>
              </svg>
              <div className="legend vertical">
                {donut.map((row, index) => <span key={row.plan} style={{ "--legend-color": colors[index % colors.length] } as CSSProperties}>{row.plan}: {row.percent}%</span>)}
              </div>
            </article>
            <article className="chartCard wide">
              <div className="cardTitle">Subscription Growth Trend</div>
              <svg viewBox="0 0 560 220" role="img" aria-label="Subscription growth area chart">
                <g transform="translate(20 24)">
                  <polygon points={`0,160 ${growthPoints} 520,160`} fill="rgba(95,135,198,0.18)" />
                  <polyline points={growthPoints} fill="none" stroke="#5f87c6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                  {data.growth.map((row, index) => {
                    const x = data.growth.length <= 1 ? 260 : (index / (data.growth.length - 1)) * 520;
                    return <circle key={row.label} cx={x} cy={160 - (row.total_active / Math.max(1, ...data.growth.map((point) => point.total_active))) * 160} r="4" fill="#4da08a"><title>{`${row.label}: ${row.total_active} active, +${row.new_subscribers}, -${row.cancelled}, ${row.net_growth_rate}% net growth`}</title></circle>;
                  })}
                </g>
              </svg>
            </article>
            <article className="chartCard">
              <div className="cardTitle">Plan Revenue Table</div>
              <div className="tableWrap compactTable">
                <table>
                  <thead><tr><th>Plan</th><th>Active</th><th>MRR</th><th>ARR</th><th>Avg LTV</th></tr></thead>
                  <tbody>
                    {data.plan_tiers.map((row) => (
                      <tr key={row.plan}><td>{row.plan}</td><td>{row.active_subscribers}</td><td>{inr.format(row.mrr)}</td><td>{inr.format(row.arr)}</td><td>{inr.format(row.avg_ltv)}</td></tr>
                    ))}
                    {!data.plan_tiers.length ? <tr><td colSpan={5} className="muted">No paid subscription data yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </>
      ) : loading ? <div className="muted">Loading revenue analytics...</div> : null}
    </section>
  );
}
