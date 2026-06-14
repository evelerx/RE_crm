type TopBarProps = {
  title: string;
  subtitle: string;
  onRefresh: () => void;
  onNewRequest: () => void;
};

export default function MarketingTopBar({ title, subtitle, onRefresh, onNewRequest }: TopBarProps) {
  return (
    <header className="marketingPromptTopBar">
      <div>
        <div className="marketingPromptLabel">Owner marketing workspace</div>
        <h1 className="marketingPromptTopBarTitle">{title}</h1>
        <p className="marketingPromptTopBarSubtitle">{subtitle}</p>
      </div>
      <div className="marketingPromptTopBarActions">
        <button className="btn ghost" type="button" onClick={onRefresh}>
          Refresh
        </button>
        <button className="btn" type="button" onClick={onNewRequest}>
          New request
        </button>
      </div>
    </header>
  );
}
