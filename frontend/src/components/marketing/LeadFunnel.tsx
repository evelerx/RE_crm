import { LeadFunnelMetrics } from "../../types/marketing";

type Props = {
  campaignName: string;
  metrics: LeadFunnelMetrics;
};

export default function LeadFunnel({ campaignName, metrics }: Props) {
  const rows = [
    { label: "Submitted", value: metrics.submitted },
    { label: "In progress", value: metrics.in_progress },
    { label: "Review", value: metrics.review },
    { label: "Completed", value: metrics.completed },
  ];
  const maxValue = Math.max(1, ...rows.map((row) => row.value));

  return (
    <section className="marketingPromptPanel">
      <div className="marketingPromptPanelHeader">
        <div>
          <div className="marketingPromptLabel">Execution funnel</div>
          <div className="marketingPromptPanelTitle">{campaignName}</div>
        </div>
      </div>
      <div className="marketingPromptFunnel">
        {rows.map((row) => (
          <div className="marketingPromptFunnelRow" key={row.label}>
            <div className="marketingPromptFunnelMeta">
              <span>{row.label}</span>
              <b>{row.value}</b>
            </div>
            <div className="marketingPromptFunnelTrack">
              <div className="marketingPromptFunnelFill" style={{ width: `${(row.value / maxValue) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
