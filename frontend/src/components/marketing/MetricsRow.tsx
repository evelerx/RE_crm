import { MarketingMetrics } from "../../types/marketing";

type Props = {
  loading: boolean;
  error: string | null;
  metrics: MarketingMetrics | null;
  onRetry: () => void;
};

export default function MetricsRow({ loading, error, metrics, onRetry }: Props) {
  if (loading) {
    return (
      <div className="marketingPromptMetricsGrid">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="marketingPromptMetricCard" key={index}>
            <div className="skeletonBar" style={{ width: "42%" }} />
            <div className="skeletonBar" style={{ width: "72%", height: 26 }} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert">
        <div>{error}</div>
        <button className="btn ghost" type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  const cards = [
    { label: "Active requests", value: metrics?.active_requests ?? 0 },
    { label: "Pending approvals", value: metrics?.pending_approvals ?? 0 },
    { label: "In progress tasks", value: metrics?.in_progress_tasks ?? 0 },
    { label: "Completed this month", value: metrics?.completed_this_month ?? 0 },
    { label: "Unread comments", value: metrics?.unread_comments ?? 0 },
    { label: "Active addon", value: (metrics?.active_addon_type || "none").replace(/_/g, " ") },
  ];

  return (
    <div className="marketingPromptMetricsGrid">
      {cards.map((card) => (
        <div className="marketingPromptMetricCard" key={card.label}>
          <span>{card.label}</span>
          <b>{card.value}</b>
        </div>
      ))}
    </div>
  );
}
