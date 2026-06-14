// MODIFIED: Part 5 — Placeholder workspace pages — Prevents dead routes while new modules are being styled into the CRM shell.
type PlaceholderWorkspacePageProps = {
  title: string;
  description: string;
  bullets?: string[];
};

export default function PlaceholderWorkspacePage({ title, description, bullets = [] }: PlaceholderWorkspacePageProps) {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">{title}</div>
          <div className="muted">{description}</div>
        </div>
      </div>

      <section className="card shellPlaceholderCard">
        <div className="shellPlaceholderHero">
          <div className="shellPlaceholderIcon">{title.slice(0, 1).toUpperCase()}</div>
          <div>
            <div className="cardTitle">{title} workspace</div>
            <div className="muted">
              This section is now wired into the CRM navigation so it can be extended safely without breaking the main workspace.
            </div>
          </div>
        </div>
        {bullets.length ? (
          <div className="shellPlaceholderList">
            {bullets.map((bullet) => (
              <div key={bullet} className="shellPlaceholderBullet">
                <span>•</span>
                <span>{bullet}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
