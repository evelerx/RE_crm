// MODIFIED: Part 6 — Admin shell — Gives /admin pages a dedicated dark frame while preserving the working admin workspace content.
// MODIFIED: Admin sidebar hash navigation wiring — Ensures admin sidebar links scroll to the correct in-page sections inside the shell content area.
import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import AdminSidebar from "./AdminSidebar";
import TopBar from "./TopBar";
import { routeBreadcrumb, routeTitle } from "./navigation";

type AdminShellProps = {
  onLogout: () => void;
  children: ReactNode;
};

export default function AdminShell({ onLogout, children }: AdminShellProps) {
  const location = useLocation();
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
    <div className="shellRoot theme-admin">
      <AdminSidebar onLogout={onLogout} />
      <div className="shellMainWrap">
        <TopBar title={routeTitle(location.pathname)} breadcrumb={routeBreadcrumb(location.pathname)} admin />
        <main ref={mainRef} className="shellMainContent adminMainContent">
          {children}
        </main>
      </div>
    </div>
  );
}
