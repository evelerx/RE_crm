// MODIFIED: Part 3 — CRM sidebar shell — Adds grouped navigation, responsive collapse, and stable account actions around existing CRM pages.
import { useMemo } from "react";
import { NavLink } from "react-router-dom";

import { crmNavGroups } from "./navigation";

type AppSidebarProps = {
  isAdmin: boolean;
  isOwnerLike: boolean;
  userName: string;
  userRole: string;
  onLogout: () => void;
};

function SidebarIcon({ icon }: { icon: string }) {
  return <span className="sidebarIconGlyph" aria-hidden="true">{icon}</span>;
}

export default function AppSidebar({ isAdmin, isOwnerLike, userName, userRole, onLogout }: AppSidebarProps) {
  const groups = useMemo(() => crmNavGroups({ isAdmin, isOwnerLike }), [isAdmin, isOwnerLike]);
  const initials = (userName || "U")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

  return (
    <aside className="shellSidebar" aria-label="CRM sidebar">
      <div className="shellLogoArea">
        <div className="shellLogoMark">
          <img src="/northstone-logo-icon.png" alt="Northstone logo" className="shellLogoImage" />
        </div>
        <div className="shellLogoText">
          <div className="shellLogoTitle">Northstone</div>
          <div className="shellLogoSub">CRM Platform</div>
        </div>
      </div>

      <div className="shellNavScroll">
        {groups.map((group) => (
          <div className="shellNavGroup" key={group.label}>
            <div className="shellNavLabel">{group.label}</div>
            <div className="shellNavItems">
              {group.items.map((item) => (
                <NavLink
                  key={`${group.label}-${item.label}`}
                  to={item.to}
                  end={item.to === "/" || item.to.startsWith("/admin")}
                  className={({ isActive }) => `shellNavItem${isActive ? " active" : ""}`}
                  title={item.label}
                >
                  <span className="shellNavIcon">
                    <SidebarIcon icon={item.icon} />
                  </span>
                  <span className="shellNavText">{item.label}</span>
                  {item.badge ? <span className="shellNavBadge">{item.badge}</span> : null}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="shellUserPill">
        <div className="shellUserAvatar">{initials || "U"}</div>
        <div className="shellUserMeta">
          <div className="shellUserName">{userName || "Northstone user"}</div>
          <div className="shellUserRole">{userRole || "CRM access"}</div>
        </div>
        <button className="shellUserMenuButton" type="button" onClick={onLogout} title="Logout">
          ...
        </button>
      </div>
    </aside>
  );
}
