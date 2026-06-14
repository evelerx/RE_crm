// MODIFIED: Part 6 — Admin sidebar shell — Uses the prompt-driven admin section map and keeps every admin nav item aligned with a real section anchor.
import { Link, useLocation } from "react-router-dom";

import { adminNavGroups } from "./navigation";

type AdminSidebarProps = {
  onLogout: () => void;
};

export default function AdminSidebar({ onLogout }: AdminSidebarProps) {
  const location = useLocation();
  const currentHash = location.hash || "#admin-dashboard";

  return (
    <aside className="shellSidebar adminSidebarTheme" aria-label="Admin sidebar">
      <div className="shellLogoArea">
        <div className="shellLogoMark">
          <img src="/northstone-logo-icon.png" alt="Northstone logo" className="shellLogoImage" />
        </div>
        <div className="shellLogoText">
          <div className="shellLogoTitle">Northstone</div>
          <div className="shellLogoSub">Admin Control</div>
        </div>
      </div>

      <div className="shellNavScroll">
        {adminNavGroups.map((group) => (
          <div className="shellNavGroup" key={group.label}>
            <div className="shellNavLabel">{group.label}</div>
            <div className="shellNavItems">
              {group.items.map((item) => {
                const itemHash = item.to.split("#")[1] || "";
                const active = currentHash === `#${itemHash}`;
                return (
                  <Link key={`${group.label}-${item.label}`} to={item.to} className={`shellNavItem${active ? " active" : ""}`} title={item.label}>
                    <span className="shellNavIcon">{item.icon}</span>
                    <span className="shellNavText">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="shellUserPill">
        <div className="shellUserAvatar adminAvatar">AD</div>
        <div className="shellUserMeta">
          <div className="shellUserName">Admin session</div>
          <div className="shellUserRole">Protected access</div>
        </div>
        <button className="shellUserMenuButton" type="button" onClick={onLogout} title="Logout">
          ...
        </button>
      </div>
    </aside>
  );
}
