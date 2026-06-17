type TopBarProps = {
  eyebrow?: string;
  title: string;
  subtitle: string;
  onRefresh: () => void;
  onNewRequest?: () => void;
  primaryActionLabel?: string;
};

export default function MarketingTopBar({
  eyebrow = "Marketing workspace",
  title,
  subtitle,
  onRefresh,
  onNewRequest,
  primaryActionLabel = "New request",
}: TopBarProps) {
  return (
    <header className="marketingPromptTopBar">
      <div>
        <div className="marketingPromptLabel">{eyebrow}</div>
        <h1 className="marketingPromptTopBarTitle">{title}</h1>
        <p className="marketingPromptTopBarSubtitle">{subtitle}</p>
      </div>
      <div className="marketingPromptTopBarActions">
        <button className="btn ghost" type="button" onClick={onRefresh}>
          Refresh
        </button>
        {onNewRequest ? (
          <button className="btn" type="button" onClick={onNewRequest}>
            {primaryActionLabel}
          </button>
        ) : null}
      </div>
    </header>
  );
}
