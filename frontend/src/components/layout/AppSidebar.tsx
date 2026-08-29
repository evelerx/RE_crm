// MODIFIED: Part 3 — CRM sidebar shell — Adds grouped navigation, responsive collapse, and stable account actions around existing CRM pages.
import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";

import { crmNavGroups } from "./navigation";

const LIFETIME_LOCKED_PATHS = new Set([
  "/whatsapp",
  "/calls",
  "/apps",
  "/ads",
  "/conversations",
  "/enterprise#ai-workbench",
  "/enterprise#ai-deal-intelligence",
]);

type AppSidebarProps = {
  isAdmin: boolean;
  isOwnerLike: boolean;
  isEnterpriseParticipant?: boolean;
  billingType?: string;
  userName: string;
  userRole: string;
  onLogout: () => void;
};

function SidebarIcon({ icon }: { icon: string }) {
  return <span className="sidebarIconGlyph" aria-hidden="true">{icon}</span>;
}

export default function AppSidebar({ isAdmin, isOwnerLike, isEnterpriseParticipant = false, billingType = "monthly", userName, userRole, onLogout }: AppSidebarProps) {
  const groups = useMemo(
    () => crmNavGroups({ isAdmin, isOwnerLike, isEnterpriseParticipant }),
    [isAdmin, isOwnerLike, isEnterpriseParticipant],
  );
  const location = useLocation();
  const isLifetime = billingType === "lifetime";
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
              {group.items.map((item) => {
                const [itemPath, itemHash = ""] = item.to.split("#");
                const currentPath = location.pathname;
                const currentHash = location.hash.replace(/^#/, "");
                const active = itemHash
                  ? currentPath === itemPath && currentHash === itemHash
                  : itemPath === "/"
                    ? currentPath === "/"
                    : currentPath === itemPath && !currentHash;

                const locked = isLifetime && LIFETIME_LOCKED_PATHS.has(item.to);

                if (locked) {
                  return (
                    <span
                      key={`${group.label}-${item.label}`}
                      className="shellNavItem shellNavItemLocked"
                      title={`${item.label} — available on Monthly / Annual plan`}
                    >
                      <span className="shellNavIcon">
                        <SidebarIcon icon={item.icon} />
                      </span>
                      <span className="shellNavText">{item.label}</span>
                      <span className="shellNavLockBadge" aria-label="locked">🔒</span>
                    </span>
                  );
                }

                return (
                  <Link
                    key={`${group.label}-${item.label}`}
                    to={item.to}
                    className={`shellNavItem${active ? " active" : ""}`}
                    title={item.label}
                  >
                    <span className="shellNavIcon">
                      <SidebarIcon icon={item.icon} />
                    </span>
                    <span className="shellNavText">{item.label}</span>
                    {item.badge ? <span className="shellNavBadge">{item.badge}</span> : null}
                  </Link>
                );
              })}
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
        <div className="shellUserActions">
          <Link className="shellUserLink" to="/account" title="My Profile">
            Profile
          </Link>
          <button className="shellUserMenuButton" type="button" onClick={onLogout} title="Logout">
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
