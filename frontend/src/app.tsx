import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api/client";
import { clearSession, getEmail, getToken } from "./auth";
import AdminPage from "./pages/AdminPage";
import AccountPage from "./pages/AccountPage";
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

function TopBar({
  isAdmin,
  isEnterprise,
  enterpriseBadge,
  reraCompleted,
  onLogout
}: {
  isAdmin: boolean;
  isEnterprise: boolean;
  enterpriseBadge: string | null;
  reraCompleted: boolean;
  onLogout: () => void;
}) {
  const email = getEmail();
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo" />
        <div>
          <div className="brandTitle">Deal Intelligence OS</div>
          <div className="brandSub">
            Pipeline | Grid | ROI <span className="brandBy">by Nihar Lakhani</span>
          </div>
        </div>
        {isAdmin ? <div className="pill adminPill">Admin</div> : null}
        {enterpriseBadge ? <div className="pill enterprisePill">{enterpriseBadge}</div> : null}
      </div>
      <nav className="navDesktop">
        {reraCompleted ? (
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
            {isEnterprise ? (
              <NavLink to="/enterprise" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
                Enterprise
              </NavLink>
            ) : null}
          </>
        ) : null}
        <NavLink to="/account" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
          Account
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
          Settings
        </NavLink>
        {isAdmin ? (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "navA active" : "navA")}>
            Admin
          </NavLink>
        ) : null}
        <button className="navA" onClick={onLogout} type="button" title={email ? `Logged in as ${email}` : "Logout"}>
          Logout
        </button>
      </nav>
      <div className="navMobile">
        {reraCompleted ? (
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
            {isEnterprise ? (
              <NavLink to="/enterprise" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
                Enterprise
              </NavLink>
            ) : null}
          </>
        ) : null}
        <NavLink to="/account" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
          Account
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
          Settings
        </NavLink>
        {isAdmin ? (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "btn ghost active" : "btn ghost")}>
            Admin
          </NavLink>
        ) : null}
        <button className="btn ghost" onClick={onLogout} type="button" title={email ? `Logged in as ${email}` : "Logout"}>
          Logout
        </button>
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
  const [isEnterprise, setIsEnterprise] = useState(false);
  const [enterpriseBadge, setEnterpriseBadge] = useState<string | null>(null);
  const [reraCompleted, setReraCompleted] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if (e.key === "dealios_token" && !e.newValue) {
        setAuthed(false);
        setIsAdmin(false);
        setIsEnterprise(false);
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
      setIsEnterprise(false);
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
          rera_completed?: boolean;
        }>("/auth/me");
        if (!cancelled) {
          setIsAdmin(Boolean(me.is_admin));
          const ownerMode = (me.plan || "free").toLowerCase() === "enterprise";
          setIsEnterprise(ownerMode);
          setEnterpriseBadge(me.enterprise_company_name?.trim() || (ownerMode ? "Enterprise" : null));
          setReraCompleted(Boolean(me.is_admin || me.rera_completed));
        }
      } catch {
        if (!cancelled) {
          setIsAdmin(false);
          setIsEnterprise(false);
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
    setIsEnterprise(false);
    setEnterpriseBadge(null);
    setReraCompleted(true);
    navigate("/");
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

  const showBottomNav = !isAdmin && reraCompleted && !location.pathname.startsWith("/enterprise") && !location.pathname.startsWith("/admin");

  return (
    <div className="appShell">
      <TopBar
        isAdmin={isAdmin}
        isEnterprise={isEnterprise}
        enterpriseBadge={enterpriseBadge}
        reraCompleted={reraCompleted || isAdmin}
        onLogout={handleLogout}
      />
      <main className="content">
        <Routes>
          <Route path="/today" element={reraCompleted || isAdmin ? <TodayPage /> : <Navigate to="/account" replace />} />
          <Route path="/" element={reraCompleted || isAdmin ? <PipelinePage /> : <Navigate to="/account" replace />} />
          <Route path="/deals" element={reraCompleted || isAdmin ? <DealsGridPage /> : <Navigate to="/account" replace />} />
          <Route path="/deals/:dealId" element={reraCompleted || isAdmin ? <DealDetailPage /> : <Navigate to="/account" replace />} />
          <Route path="/contacts" element={reraCompleted || isAdmin ? <ContactsPage /> : <Navigate to="/account" replace />} />
          <Route path="/calc" element={reraCompleted || isAdmin ? <CalculatorPage /> : <Navigate to="/account" replace />} />
          <Route path="/insights" element={reraCompleted || isAdmin ? <InsightsPage /> : <Navigate to="/account" replace />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="/enterprise" element={isEnterprise && (reraCompleted || isAdmin) ? <EnterprisePage /> : <Navigate to="/account" replace />} />
          <Route path="*" element={<Navigate to={reraCompleted || isAdmin ? "/" : "/account"} replace />} />
        </Routes>
      </main>
      {showBottomNav ? <BottomNav /> : null}
    </div>
  );
}
