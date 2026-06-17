// MODIFIED: CRM shell hash navigation wiring — Ensures enterprise sidebar links scroll to live in-page sections inside the app shell instead of appearing non-functional.
import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import AppSidebar from "./AppSidebar";
import TopBar from "./TopBar";
import { routeBreadcrumb, routeTitle } from "./navigation";

type AppShellProps = {
  isAdmin: boolean;
  isOwnerLike: boolean;
  userName: string;
  userRole: string;
  onLogout: () => void;
  children: ReactNode;
};

export default function AppShell({ isAdmin, isOwnerLike, userName, userRole, onLogout, children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = mainRef.current;
    if (!container) return;

    if (!location.hash) {
      container.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const hashId = decodeURIComponent(location.hash.replace(/^#/, ""));
    const target = document.getElementById(hashId);

    if (!target) return;

    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.pathname, location.hash]);

  return (
    <div className="shellRoot">
      <AppSidebar
        isAdmin={isAdmin}
        isOwnerLike={isOwnerLike}
        userName={userName}
        userRole={userRole}
        onLogout={onLogout}
      />
      <div className="shellMainWrap">
        <TopBar
          title={routeTitle(location.pathname)}
          breadcrumb={routeBreadcrumb(location.pathname)}
          actions={
            <button className="shellPrimaryButton" type="button" onClick={() => navigate("/deals")}>
              + New Deal
            </button>
          }
        />
        <main ref={mainRef} className="shellMainContent">{children}</main>
      </div>
    </div>
  );
}
