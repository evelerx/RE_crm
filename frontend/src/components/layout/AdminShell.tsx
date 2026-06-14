// MODIFIED: Part 6 — Admin shell — Gives /admin pages a dedicated dark frame while preserving the working admin workspace content.
import type { ReactNode } from "react";
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

  return (
    <div className="shellRoot theme-admin">
      <AdminSidebar onLogout={onLogout} />
      <div className="shellMainWrap">
        <TopBar title={routeTitle(location.pathname)} breadcrumb={routeBreadcrumb(location.pathname)} admin />
        <main className="shellMainContent adminMainContent">{children}</main>
      </div>
    </div>
  );
}
