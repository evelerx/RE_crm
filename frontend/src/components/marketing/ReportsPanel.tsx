import { MarketingMetrics } from "../../types/marketing";

export default function ReportsPanel({ metrics }: { metrics: MarketingMetrics | null }) {
  const cards = [
    { label: "Active requests", value: metrics?.active_requests ?? 0 },
    { label: "Pending approvals", value: metrics?.pending_approvals ?? 0 },
    { label: "Completed this month", value: metrics?.completed_this_month ?? 0 },
    { label: "Unread comments", value: metrics?.unread_comments ?? 0 },
  ];

  return (
    <section className="marketingPromptPanel">
      <div className="marketingPromptPanelHeader">
        <div>
          <div className="marketingPromptLabel">Reports snapshot</div>
          <div className="marketingPromptPanelTitle">Marketing performance summary</div>
        </div>
      </div>
      <div className="marketingPromptReportsGrid">
        {cards.map((card) => (
          <div className="marketingPromptMetricCard" key={card.label}>
            <span>{card.label}</span>
            <b>{card.value}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
