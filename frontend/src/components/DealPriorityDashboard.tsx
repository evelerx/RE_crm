// MODIFIED: Phase 1 — Deal Intelligence dashboard widget — Renders owner/main-only ranked time and ad-budget recommendations from the server-scored endpoint.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

type DealPriorityItem = {
  deal_id: string;
  deal_name: string;
  contact_name: string;
  lead_source: string;
  deal_value: number;
  score: number;
  urgency: "urgent" | "important" | "track";
  days_since_last_activity: number;
  days_in_stage: number;
  overdue_tasks_count: number;
  engagement_score: number;
  recommended_action: string;
};

type DealPriorityResponse = {
  last_updated_at: string;
  needs_time: DealPriorityItem[];
  ad_budget: DealPriorityItem[];
};

type DealPriorityDashboardProps = {
  visible: boolean;
};

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

function urgencyLabel(urgency: DealPriorityItem["urgency"]) {
  if (urgency === "urgent") return "Action today";
  if (urgency === "important") return "This week";
  return "Monitor";
}

function formatTime(value: string | null) {
  if (!value) return "Not refreshed yet";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function PriorityList({
  title,
  subtitle,
  items,
  expanded,
  onToggle,
  mode
}: {
  title: string;
  subtitle: string;
  items: DealPriorityItem[];
  expanded: boolean;
  onToggle: () => void;
  mode: "time" | "ads";
}) {
  const visibleItems = expanded ? items : items.slice(0, 5);
  return (
    <section className="card priorityCard" aria-label={title}>
      <div className="priorityCardHeader">
        <div>
          <div className="cardTitle">{title}</div>
          <div className="muted small">{subtitle}</div>
        </div>
        {items.length > 5 ? (
          <button className="btn ghost compact" type="button" onClick={onToggle}>
            {expanded ? "Show Less" : "View All"}
          </button>
        ) : null}
      </div>
      <div className="priorityRows">
        {visibleItems.length ? (
          visibleItems.map((item) => (
            <Link key={`${mode}-${item.deal_id}`} className={`priorityRow ${item.urgency}`} to={`/deals/${item.deal_id}`}>
              <div className="priorityTopline">
                <div>
                  <b>{item.deal_name}</b>
                  <span>{mode === "time" ? item.contact_name : item.lead_source.replace("_", " ")}</span>
                </div>
                <span className={`priorityBadge ${item.urgency}`}>{urgencyLabel(item.urgency)}</span>
              </div>
              <div className="priorityMetrics">
                <span>{money.format(item.deal_value || 0)}</span>
                {mode === "time" ? (
                  <>
                    <span>{item.days_since_last_activity}d since activity</span>
                    <span>{item.overdue_tasks_count} overdue</span>
                  </>
                ) : (
                  <>
                    <span>Engagement {item.engagement_score}</span>
                    <span>Score {item.score}</span>
                  </>
                )}
              </div>
              <p>{item.recommended_action}</p>
            </Link>
          ))
        ) : (
          <div className="priorityEmpty">All deals are on track. Nice work.</div>
        )}
      </div>
    </section>
  );
}

export default function DealPriorityDashboard({ visible }: DealPriorityDashboardProps) {
  const [data, setData] = useState<DealPriorityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTime, setExpandedTime] = useState(false);
  const [expandedAds, setExpandedAds] = useState(false);

  const load = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<DealPriorityResponse>("/deals/intelligence/priority"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deal Intelligence is not available for this account.");
    } finally {
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasRows = useMemo(() => Boolean((data?.needs_time.length || 0) + (data?.ad_budget.length || 0)), [data]);

  // Role-based access control verified: this component is not rendered for employee/staff sessions by the parent,
  // and the API still returns 403 if an employee attempts to call it directly.
  if (!visible) return null;

  return (
    <section className="dealPriorityShell">
      <div className="priorityHero">
        <div>
          <div className="eyebrowText">Deal Intelligence</div>
          <div className="h2">What deserves your time and ad budget?</div>
          <div className="muted">
            Auto-scores active deals using stage age, activity gaps, value, overdue tasks, engagement, lead source, and close probability.
          </div>
        </div>
        <div className="priorityActions">
          <span className="muted small">Last updated: {formatTime(data?.last_updated_at || null)}</span>
          <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      {error ? <div className="alert">{error}</div> : null}
      {!loading && !error && !hasRows && data ? <div className="card priorityEmpty">All deals are on track. Nice work.</div> : null}
      <div className="priorityGrid">
        <PriorityList
          title="Needs Your Time Right Now"
          subtitle="High-value, stalled, overdue, or near-close deals."
          items={data?.needs_time || []}
          expanded={expandedTime}
          onToggle={() => setExpandedTime((value) => !value)}
          mode="time"
        />
        <PriorityList
          title="Worth Putting Ad Budget Behind"
          subtitle="Warm, valuable, proven, or retargeting-ready deals."
          items={data?.ad_budget || []}
          expanded={expandedAds}
          onToggle={() => setExpandedAds((value) => !value)}
          mode="ads"
        />
      </div>
    </section>
  );
}
