type Props = {
  status: string;
  canEdit: boolean;
  onPick: (status: string) => void;
};

const phases = ["submitted", "under_review", "approved", "in_progress", "completed"];

export default function PhaseTracker({ status, canEdit, onPick }: Props) {
  return (
    <section className="marketingPromptPanel">
      <div className="marketingPromptPanelHeader">
        <div>
          <div className="marketingPromptLabel">Request phase</div>
          <div className="marketingPromptPanelTitle">Current lifecycle</div>
        </div>
      </div>
      <div className="marketingPromptPhaseRow">
        {phases.map((phase) => (
          <button
            key={phase}
            className={`marketingPromptPhasePill ${status === phase ? "active" : ""}`}
            type="button"
            disabled={!canEdit}
            onClick={() => canEdit && onPick(phase)}
          >
            {phase.replace(/_/g, " ")}
          </button>
        ))}
      </div>
    </section>
  );
}
