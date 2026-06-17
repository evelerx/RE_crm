import type { MarketingRole } from "../../types/marketing";

type SidebarProps = {
  active: string;
  pendingApprovals: number;
  unreadComments: number;
  role: MarketingRole | string;
  onChange: (value: string) => void;
  onNewRequest: () => void;
  showNewRequest?: boolean;
};

function itemsForRole(role: string) {
  if (role === "admin") {
    return [
      { key: "overview", label: "Overview", meta: "Request queue" },
      { key: "accounts", label: "Accounts", meta: "Portal allotment" },
      { key: "messages", label: "Messages", meta: "Activity feed" },
      { key: "reports", label: "Reports", meta: "Commercial view" },
    ];
  }
  if (role === "agency" || role === "marketing_manager") {
    return [
      { key: "overview", label: "Overview", meta: "Agency review" },
      { key: "approvals", label: "Approvals", meta: "Decision queue" },
      { key: "messages", label: "Messages", meta: "Team thread" },
      { key: "reports", label: "Reports", meta: "Delivery view" },
    ];
  }
  if (role === "marketing_employee") {
    return [
      { key: "overview", label: "Overview", meta: "Assigned work" },
      { key: "messages", label: "Messages", meta: "Execution thread" },
      { key: "reports", label: "Reports", meta: "Performance" },
    ];
  }
  return [
    { key: "overview", label: "Overview", meta: "Request summary" },
    { key: "messages", label: "Messages", meta: "Owner thread" },
    { key: "reports", label: "Reports", meta: "Performance" },
    { key: "billing", label: "Billing", meta: "Addon status" },
  ];
}

function roleCopy(role: string) {
  if (role === "admin") return "Admin control for marketing requests, account allotment, and execution visibility.";
  if (role === "agency" || role === "marketing_manager") return "Agency review and manager routing across approvals, comments, and execution handoffs.";
  if (role === "marketing_employee") return "Execution workspace for assigned marketing delivery, updates, and campaign logging.";
  return "Subscriber visibility for marketing requests, approvals, campaign delivery, and billing state.";
}

export default function MarketingSidebar({
  active,
  pendingApprovals,
  unreadComments,
  role,
  onChange,
  onNewRequest,
  showNewRequest = true,
}: SidebarProps) {
  const items = itemsForRole(role);
  return (
    <aside className="marketingPromptSidebar">
      <div className="marketingPromptSidebarBrand">
        <div className="marketingPromptSidebarEyebrow">Northstone</div>
        <div className="marketingPromptSidebarTitle">Marketing</div>
        <p className="marketingPromptSidebarCopy">{roleCopy(role)}</p>
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
      {showNewRequest ? (
        <button className="btn marketingPromptSidebarCta" type="button" onClick={onNewRequest}>
          New request
        </button>
      ) : null}
    </aside>
  );
}
