import { MarketingMetrics } from "../../types/marketing";

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

export default function BillingPanel({ metrics }: { metrics: MarketingMetrics | null }) {
  return (
    <section className="marketingPromptPanel">
      <div className="marketingPromptPanelHeader">
        <div>
          <div className="marketingPromptLabel">Addon billing</div>
          <div className="marketingPromptPanelTitle">Subscription status</div>
        </div>
      </div>
      <div className="marketingPromptBillingCard">
        <div>
          <span>Active addon</span>
          <b>{(metrics?.active_addon_type || "none").replace(/_/g, " ")}</b>
        </div>
        <div>
          <span>Renews on</span>
          <b>{formatDate(metrics?.active_addon_renews_on || null)}</b>
        </div>
      </div>
    </section>
  );
}
