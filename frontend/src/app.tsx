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
import CallLogPage from "./pages/CallLogPage";
import ContactsPage from "./pages/ContactsPage";
import DealDetailPage from "./pages/DealDetailPage";
import DealsGridPage from "./pages/DealsGridPage";
import EnterprisePage from "./pages/EnterprisePage";
import IntegrationsSetupPage from "./pages/IntegrationsSetupPage";
import InventoryPage from "./pages/InventoryPage";
import InsightsPage from "./pages/InsightsPage";
import LoginPage from "./pages/LoginPage";
import PipelinePage from "./pages/PipelinePage";
import SettingsPage from "./pages/SettingsPage";
import TodayPage from "./pages/TodayPage";
import WebhooksPage from "./pages/WebhooksPage";

function TopBar({
  isAdmin,
  canManageIntegrations,
  enterpriseBadge,
  canUseInventory,
  onLogout,
  loginHref
}: {
  isAdmin: boolean;
  canManageIntegrations: boolean;
  enterpriseBadge: string | null;
  canUseInventory: boolean;
  onLogout?: () => void;
  loginHref?: string;
}) {
  const email = getEmail();
  const isPreview = Boolean(loginHref && !onLogout);
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
        <NavLink to="/calls" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
          Calls
        </NavLink>
        {canUseInventory ? (
          <NavLink to="/inventory" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Inventory
          </NavLink>
        ) : null}
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
        {canManageIntegrations ? (
          <NavLink to="/integrations/setup" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Integrations
          </NavLink>
        ) : null}
        {canManageIntegrations ? (
          <NavLink to="/webhooks" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Webhooks
          </NavLink>
        ) : null}
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
          <NavLink to="/calls" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Calls
          </NavLink>
          {canUseInventory ? (
            <NavLink to="/inventory" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
              Inventory
            </NavLink>
          ) : null}
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
        {canManageIntegrations ? (
          <NavLink to="/integrations/setup" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Integrations
          </NavLink>
        ) : null}
        {canManageIntegrations ? (
          <NavLink to="/webhooks" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Webhooks
          </NavLink>
        ) : null}
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
  const [canManageIntegrations, setCanManageIntegrations] = useState(false);
  const [enterpriseBadge, setEnterpriseBadge] = useState<string | null>(null);
  const [reraCompleted, setReraCompleted] = useState(true);
  const [canUseInventory, setCanUseInventory] = useState(false);
  const adminIdleTimerRef = useRef<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if ((e.key === "northstonecrm_token" || e.key === "dealios_token") && !e.newValue) {
        setAuthed(false);
        setIsAdmin(false);
        setCanManageIntegrations(false);
        setCanUseInventory(false);
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
      setCanManageIntegrations(false);
      setCanUseInventory(false);
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
          const builderMode = plan === "builder";
          const memberRole = (me.enterprise_member_role || "").toLowerCase();
          setCanManageIntegrations(Boolean(me.is_admin || ownerMode));
          setCanUseInventory(Boolean(me.is_admin || builderMode));
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
          setCanManageIntegrations(false);
          setCanUseInventory(false);
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
    setCanManageIntegrations(false);
    setCanUseInventory(false);
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
        setCanUseInventory(false);
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
        canManageIntegrations={canManageIntegrations}
        enterpriseBadge={enterpriseBadge}
        canUseInventory={canUseInventory}
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
          <Route path="/calls" element={<CallLogPage />} />
          <Route path="/inventory" element={canUseInventory || isAdmin ? <InventoryPage /> : <Navigate to="/" replace />} />
          <Route path="/calc" element={<CalculatorPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/integrations/setup" element={canManageIntegrations ? <IntegrationsSetupPage /> : <Navigate to="/" replace />} />
          <Route path="/webhooks" element={canManageIntegrations ? <WebhooksPage /> : <Navigate to="/" replace />} />
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
