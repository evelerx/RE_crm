// MODIFIED: Phase 5 — Added admin inactivity timeout — Clears admin sessions after 30 minutes without activity.
import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api/client";
import { clearSession, getEmail, getToken } from "./auth";
import TutorialBubble from "./components/TutorialBubble";
import AdminPage from "./pages/AdminPage";
import { AdminOwnerContactsPage, AdminOwnerDealsPage, AdminOwnerPipelinePage } from "./pages/AdminWorkspacePages";
import AccountPage from "./pages/AccountPage";
import AppsPage from "./pages/AppsPage";
import BuilderPublicPage from "./pages/BuilderPublicPage";
import CalculatorPage from "./pages/CalculatorPage";
import ContactsPage from "./pages/ContactsPage";
import DealDetailPage from "./pages/DealDetailPage";
import DealsGridPage from "./pages/DealsGridPage";
import EnterprisePage from "./pages/EnterprisePage";
import InsightsPage from "./pages/InsightsPage";
import LoginPage from "./pages/LoginPage";
import PipelinePage from "./pages/PipelinePage";
import SettingsPage from "./pages/SettingsPage";
import TodayPage from "./pages/TodayPage";

type NotifActivity = { id: string; summary: string; due_at: string | null; kind: string; overdue: boolean };
type NextActionsSnippet = { overdue: Omit<NotifActivity, "overdue">[]; upcoming: Omit<NotifActivity, "overdue">[] };

function TopBar({
  isAdmin,
  enterpriseBadge,
  onLogout,
  loginHref
}: {
  isAdmin: boolean;
  enterpriseBadge: string | null;
  onLogout?: () => void;
  loginHref?: string;
}) {
  const email = getEmail();
  const isPreview = Boolean(loginHref && !onLogout);
  const isAuthed = Boolean(onLogout);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<NotifActivity[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthed) return;
    api<NextActionsSnippet>("/next-actions?days=7")
      .then((data) => {
        setOverdueCount(data.overdue.length);
        setNotifItems([
          ...data.overdue.map((a) => ({ ...a, overdue: true })),
          ...data.upcoming.map((a) => ({ ...a, overdue: false })),
        ].slice(0, 20));
      })
      .catch(() => {});
  }, [isAuthed]);

  useEffect(() => {
    if (!notifOpen) return;
    function handleOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [notifOpen]);

  function fmtDue(due: string | null) {
    if (!due) return "";
    const d = new Date(due);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">
          <img src="/northstone-logo-icon.png" alt="Northstone logo" className="logoMark" />
        </div>
        <div className="brandMeta">
          <div className="brandTitle">Northstone</div>
          <div className="brandSub">
            Pipeline | Grid | ROI
          </div>
          {isAdmin || enterpriseBadge ? (
            <div className="brandBadges">
              {isAdmin ? <div className="pill adminPill">Admin</div> : null}
              {enterpriseBadge ? <div className="pill enterprisePill">{enterpriseBadge}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
      <nav className="navDesktop">
        <>
          <NavLink to="/today" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Today
          </NavLink>
          <NavLink to="/" end className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Pipeline
          </NavLink>
          <NavLink to="/deals" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Deals
          </NavLink>
          <NavLink to="/contacts" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Contacts
          </NavLink>
          <NavLink to="/calc" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            ROI
          </NavLink>
          <NavLink to="/insights" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Insights
          </NavLink>
          <NavLink to="/enterprise" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Enterprise
          </NavLink>
        </>
        <NavLink to="/account" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
          Account
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
          Settings
        </NavLink>
        <NavLink to="/apps" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
          Apps
        </NavLink>
        {isAdmin ? (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Admin
          </NavLink>
        ) : null}
        {onLogout ? (
          <button className="navA" onClick={onLogout} type="button" title={email ? `Logged in as ${email}` : "Logout"}>
            Logout
          </button>
        ) : (
          <NavLink to={loginHref || "/login"} className={({ isActive }) => (isActive || isPreview ? "navA active" : "navA")}>
            Login
          </NavLink>
        )}
      </nav>
      <div className="navMobile">
        <>
          <NavLink to="/today" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Today
          </NavLink>
          <NavLink to="/" end className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Pipeline
          </NavLink>
          <NavLink to="/deals" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Deals
          </NavLink>
          <NavLink to="/contacts" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Contacts
          </NavLink>
          <NavLink to="/calc" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            ROI
          </NavLink>
          <NavLink to="/insights" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Insights
          </NavLink>
          <NavLink to="/enterprise" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Enterprise
          </NavLink>
        </>
        <NavLink to="/account" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
          Account
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
          Settings
        </NavLink>
        <NavLink to="/apps" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
          Apps
        </NavLink>
        {isAdmin ? (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Admin
          </NavLink>
        ) : null}
        {onLogout ? (
          <button className="btn ghost" onClick={onLogout} type="button" title={email ? `Logged in as ${email}` : "Logout"}>
            Logout
          </button>
        ) : (
          <NavLink to={loginHref || "/login"} className={({ isActive }) => (isActive || isPreview ? "btn ghost active" : "btn ghost")}>
            Login
          </NavLink>
        )}
      </div>
      {isAuthed ? (
        <div className="topbarActions" ref={notifRef}>
          <button className="topbarIconBtn" type="button" onClick={() => setNotifOpen((v) => !v)} aria-label="Notifications">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {overdueCount > 0 ? <span className="notifBadge">{overdueCount > 9 ? "9+" : overdueCount}</span> : null}
          </button>
          <a className="topbarIconBtn" href="https://wa.me/919834241892" target="_blank" rel="noopener noreferrer" aria-label="Help on WhatsApp">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.978-1.414A9.955 9.955 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm4.93 13.144c-.207.578-1.21 1.107-1.66 1.15-.45.044-.877.2-2.96-.617-2.494-.983-4.103-3.524-4.228-3.688-.124-.165-1.015-1.35-1.015-2.576 0-1.226.64-1.83.868-2.082.228-.25.497-.313.662-.313.166 0 .33.002.475.008.152.007.357-.058.558.425.207.497.703 1.72.765 1.844.062.124.103.27.02.434-.082.165-.124.268-.248.413-.124.146-.26.326-.373.438-.124.124-.254.258-.11.506.145.248.644 1.062 1.383 1.72.95.846 1.752 1.108 2 1.232.248.124.393.103.538-.062.145-.165.62-.722.786-.97.165-.248.33-.207.558-.124.228.082 1.45.683 1.7.807.248.124.413.186.475.29.062.103.062.6-.145 1.177z"/>
            </svg>
          </a>
          {notifOpen ? (
            <div className="notifPanel">
              <div className="notifPanelHeader">
                Tasks &amp; Deadlines
                <NavLink to="/today" className="notifViewAll" onClick={() => setNotifOpen(false)}>View all →</NavLink>
              </div>
              {notifItems.length === 0 ? (
                <div className="muted small" style={{ padding: "10px 0" }}>No upcoming tasks or deadlines.</div>
              ) : notifItems.map((item) => (
                <NavLink key={item.id} to="/today" className={`notifItem${item.overdue ? " notifOverdue" : ""}`} onClick={() => setNotifOpen(false)}>
                  <div className="notifItemSummary">{item.summary}</div>
                  {item.due_at ? <div className="notifItemDue">{item.overdue ? "Overdue · " : ""}{fmtDue(item.due_at)}</div> : null}
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

function BottomNav() {
  return (
    <nav className="bottomNav">
      <NavLink to="/today" className={({ isActive }) => (isActive ? "bn active" : "bn")}>
        Today
      </NavLink>
      <NavLink to="/" end className={({ isActive }) => (isActive ? "bn active" : "bn")}>
        Pipeline
      </NavLink>
      <NavLink to="/deals" className={({ isActive }) => (isActive ? "bn active" : "bn")}>
        Deals
      </NavLink>
      <NavLink to="/contacts" className={({ isActive }) => (isActive ? "bn active" : "bn")}>
        Contacts
      </NavLink>
      <NavLink to="/calc" className={({ isActive }) => (isActive ? "bn active" : "bn")}>
        ROI
      </NavLink>
    </nav>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [isAdmin, setIsAdmin] = useState(false);
  const [enterpriseBadge, setEnterpriseBadge] = useState<string | null>(null);
  const [reraCompleted, setReraCompleted] = useState(true);
  const adminIdleTimerRef = useRef<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if ((e.key === "northstonecrm_token" || e.key === "dealios_token") && !e.newValue) {
        setAuthed(false);
        setIsAdmin(false);
        setEnterpriseBadge(null);
        setReraCompleted(true);
      }
    }
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  useEffect(() => {
    if (!authed) {
      setIsAdmin(false);
      setEnterpriseBadge(null);
      setReraCompleted(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{
          email: string;
          plan: string;
          is_admin: boolean;
          enterprise_owner_id?: string | null;
          enterprise_company_name?: string;
          enterprise_member_role?: string;
          rera_completed?: boolean;
        }>("/auth/me");
        if (!cancelled) {
          setIsAdmin(Boolean(me.is_admin));
          const plan = (me.plan || "free").toLowerCase();
          const ownerMode = plan === "enterprise" || plan === "builder";
          const memberRole = (me.enterprise_member_role || "").toLowerCase();
          setEnterpriseBadge(
            me.enterprise_company_name?.trim() ||
              (
                plan === "builder"
                  ? "Builder"
                  : ownerMode
                    ? "Enterprise"
                    : memberRole === "broker"
                      ? "Broker"
                      : memberRole === "cp"
                        ? "CP"
                        : null
              )
          );
          setReraCompleted(Boolean(me.is_admin || me.rera_completed));
        }
      } catch {
        if (!cancelled) {
          setIsAdmin(false);
          setEnterpriseBadge(null);
          setReraCompleted(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  function handleLogout() {
    clearSession();
    setAuthed(false);
    setIsAdmin(false);
    setEnterpriseBadge(null);
    setReraCompleted(true);
    navigate("/login");
  }

  useEffect(() => {
    if (!authed || !isAdmin) {
      if (adminIdleTimerRef.current) {
        window.clearTimeout(adminIdleTimerRef.current);
        adminIdleTimerRef.current = null;
      }
      return;
    }
    const resetAdminIdleTimer = () => {
      if (adminIdleTimerRef.current) window.clearTimeout(adminIdleTimerRef.current);
      adminIdleTimerRef.current = window.setTimeout(() => {
        clearSession();
        setAuthed(false);
        setIsAdmin(false);
        setEnterpriseBadge(null);
        setReraCompleted(true);
        navigate("/login");
      }, 30 * 60 * 1000);
    };
    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((eventName) => window.addEventListener(eventName, resetAdminIdleTimer, { passive: true }));
    resetAdminIdleTimer();
    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, resetAdminIdleTimer));
      if (adminIdleTimerRef.current) window.clearTimeout(adminIdleTimerRef.current);
      adminIdleTimerRef.current = null;
    };
  }, [authed, isAdmin, navigate]);

  if (location.pathname.startsWith("/builders/")) {
    return <BuilderPublicPage />;
  }

  if (!authed) {
    return (
      <LoginPage
        onLoggedIn={async () => {
          setAuthed(true);
        }}
      />
    );
  }

  const showBottomNav = !isAdmin && !location.pathname.startsWith("/enterprise") && !location.pathname.startsWith("/admin");

  return (
    <div className="appShell">
      <TopBar
        isAdmin={isAdmin}
        enterpriseBadge={enterpriseBadge}
        onLogout={handleLogout}
      />
      <main className="content">
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="/" element={isAdmin ? <AdminOwnerPipelinePage /> : <PipelinePage />} />
          <Route path="/deals" element={isAdmin ? <AdminOwnerDealsPage /> : <DealsGridPage />} />
          <Route path="/deals/:dealId" element={<DealDetailPage />} />
          <Route path="/contacts" element={isAdmin ? <AdminOwnerContactsPage /> : <ContactsPage />} />
          <Route path="/calc" element={<CalculatorPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="/enterprise" element={<EnterprisePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TutorialBubble
        isAdmin={isAdmin}
        reraCompleted={reraCompleted || isAdmin}
        email={getEmail() || ""}
      />
      {showBottomNav ? <BottomNav /> : null}
    </div>
  );
}
