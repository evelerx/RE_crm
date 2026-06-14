type SidebarProps = {
  active: string;
  pendingApprovals: number;
  unreadComments: number;
  onChange: (value: string) => void;
  onNewRequest: () => void;
};

const items = [
  { key: "overview", label: "Overview", meta: "Ops summary" },
  { key: "messages", label: "Messages", meta: "Owner thread" },
  { key: "reports", label: "Reports", meta: "Performance" },
  { key: "billing", label: "Billing", meta: "Addon status" },
];

export default function MarketingSidebar({ active, pendingApprovals, unreadComments, onChange, onNewRequest }: SidebarProps) {
  return (
    <aside className="marketingPromptSidebar">
      <div className="marketingPromptSidebarBrand">
        <div className="marketingPromptSidebarEyebrow">Northstone</div>
        <div className="marketingPromptSidebarTitle">Marketing</div>
        <p className="marketingPromptSidebarCopy">Owner visibility for agency execution, approvals, and campaign delivery.</p>
      </div>
      <div className="marketingPromptSidebarStats">
        <div className="marketingPromptSidebarStat">
          <span>Approvals</span>
          <b>{pendingApprovals}</b>
        </div>
        <div className="marketingPromptSidebarStat">
          <span>Unread</span>
          <b>{unreadComments}</b>
        </div>
      </div>
      <nav className="marketingPromptNav">
        {items.map((item) => (
          <button
            key={item.key}
            className={`marketingPromptNavItem ${active === item.key ? "active" : ""}`}
            type="button"
            onClick={() => onChange(item.key)}
          >
            <div>
              <strong>{item.label}</strong>
              <span>{item.meta}</span>
            </div>
          </button>
        ))}
      </nav>
      <button className="btn marketingPromptSidebarCta" type="button" onClick={onNewRequest}>
        New request
      </button>
    </aside>
  );
}
