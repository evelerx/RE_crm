import { Campaign } from "../../types/marketing";

type Props = {
  loading: boolean;
  error: string | null;
  campaigns: Campaign[];
  onRetry: () => void;
  onOpen: (campaign: Campaign) => void;
  onCreateRequest: () => void;
};

function formatCurrency(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export default function CampaignsTable({ loading, error, campaigns, onRetry, onOpen, onCreateRequest }: Props) {
  if (loading) return <div className="muted">Loading campaign tasks...</div>;
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
  if (campaigns.length === 0) {
    return (
      <div className="marketingPromptEmpty">
        <p>No active campaign tasks yet.</p>
        <button className="btn" type="button" onClick={onCreateRequest}>
          Submit your first request
        </button>
      </div>
    );
  }
  return (
    <div className="marketingPromptCampaignTable">
      <div className="marketingPromptCampaignHead">
        <span>Task</span>
        <span>Owner</span>
        <span>Status</span>
        <span>Budget</span>
      </div>
      {campaigns.map((campaign) => (
        <button className="marketingPromptCampaignRow" key={campaign.id} type="button" onClick={() => onOpen(campaign)}>
          <div>
            <strong>{campaign.name}</strong>
            <span>{campaign.channel}</span>
          </div>
          <div>{campaign.assigned_to_name || "Unassigned"}</div>
          <div><span className={`marketingPromptStatusChip ${campaign.status}`}>{campaign.status.replace(/_/g, " ")}</span></div>
          <div>{formatCurrency(campaign.budget || campaign.spend || 0)}</div>
        </button>
      ))}
    </div>
  );
}
