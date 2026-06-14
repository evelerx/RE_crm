// MODIFIED: Part 2 — CRM app shell — Wraps existing pages in the new sidebar + topbar layout without changing page logic.
import type { ReactNode } from "react";
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
        <main className="shellMainContent">{children}</main>
      </div>
    </div>
  );
}
