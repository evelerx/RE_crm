import { Approval } from "../../types/marketing";

type Props = {
  loading: boolean;
  error: string | null;
  approvals: Approval[];
  onRetry: () => void;
  onReview: (approval: Approval) => void;
  onApprove: (approval: Approval) => void;
};

export default function PendingApprovals({ loading, error, approvals, onRetry, onReview, onApprove }: Props) {
  if (loading) return <div className="muted">Loading approvals...</div>;
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
  if (approvals.length === 0) {
    return <div className="marketingPromptEmpty">No approvals are waiting on you right now.</div>;
  }
  return (
    <div className="marketingPromptApprovalList">
      {approvals.map((approval) => (
        <div className="marketingPromptApprovalCard" key={approval.id}>
          <div>
            <strong>{approval.approval_type.replace(/_/g, " ")}</strong>
            <p>{approval.description}</p>
          </div>
          <div className="marketingPromptApprovalActions">
            <button className="btn ghost" type="button" onClick={() => onReview(approval)}>
              Review
            </button>
            <button className="btn" type="button" onClick={() => onApprove(approval)}>
              Approve
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
