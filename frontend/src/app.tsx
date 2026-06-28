// MODIFIED: Parts 2-6 — Wired the shared CRM/admin shells and expanded workspace routes — Surfaces the new layout and page structure without changing existing business logic.
import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { api } from "./api/client";
import { clearSession, getEmail, getToken } from "./auth";
import TutorialBubble from "./components/TutorialBubble";
import AdminShell from "./components/layout/AdminShell";
import AppShell from "./components/layout/AppShell";
import AccountPage from "./pages/AccountPage";
import AdminPage from "./pages/AdminPage";
import { AdminOwnerContactsPage, AdminOwnerDealsPage, AdminOwnerPipelinePage } from "./pages/AdminWorkspacePages";
import AppsPage from "./pages/AppsPage";
import AutomationsPage from "./pages/AutomationsPage";
import BuilderPublicPage from "./pages/BuilderPublicPage";
import CalculatorPage from "./pages/CalculatorPage";
import CallsPage from "./pages/CallsPage";
import ContactsPage from "./pages/ContactsPage";
import ConversationsPage from "./pages/ConversationsPage";
import DealDetailPage from "./pages/DealDetailPage";
import DealsGridPage from "./pages/DealsGridPage";
import EnterprisePage from "./pages/EnterprisePage";
import InboxPage from "./pages/InboxPage";
import InsightsPage from "./pages/InsightsPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import LoginPage from "./pages/LoginPage";
import MarketingPage from "./pages/MarketingPage";
import PipelinePage from "./pages/PipelinePage";
import PlaceholderWorkspacePage from "./pages/PlaceholderWorkspacePage";
import PropertiesPage from "./pages/PropertiesPage";
import SequencesPage from "./pages/SequencesPage";
import SettingsPage from "./pages/SettingsPage";
import TargetsPage from "./pages/TargetsPage";
import TodayPage from "./pages/TodayPage";
import WhatsAppPage from "./pages/WhatsAppPage";
import WebhooksPage from "./pages/WebhooksPage";

type MeResponse = {
  email: string;
  plan: string;
  is_admin: boolean;
  full_name?: string | null;
  enterprise_owner_id?: string | null;
  enterprise_company_name?: string;
  enterprise_member_role?: string;
  rera_completed?: boolean;
};

function CrmRoutes({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/today" element={<TodayPage />} />
      <Route path="/" element={isAdmin ? <AdminOwnerPipelinePage /> : <PipelinePage />} />
      <Route path="/deals" element={isAdmin ? <AdminOwnerDealsPage /> : <DealsGridPage />} />
      <Route path="/deals/:dealId" element={<DealDetailPage />} />
      <Route path="/contacts" element={isAdmin ? <AdminOwnerContactsPage /> : <ContactsPage />} />
      <Route path="/properties" element={<PropertiesPage />} />
      <Route path="/inventory" element={<PropertiesPage />} />
      <Route path="/whatsapp" element={<WhatsAppPage />} />
      <Route path="/inbox" element={<InboxPage />} />
      <Route path="/conversations" element={<ConversationsPage />} />
      <Route path="/calls" element={<CallsPage />} />
      <Route path="/ads" element={<MarketingPage />} />
      <Route path="/automations" element={<AutomationsPage />} />
      <Route path="/webhooks" element={<WebhooksPage />} />
      <Route
        path="/integrations"
        element={
          <PlaceholderWorkspacePage
            title="Integrations Setup"
            description="External channel, ad, and lead-source setup can now route through a dedicated integrations view."
            bullets={["Provider connection health", "Webhook URL copy", "Token and permission checklist"]}
          />
        }
      />
      <Route path="/calc" element={<CalculatorPage />} />
      <Route path="/insights" element={<InsightsPage />} />
      <Route path="/leaderboard" element={<LeaderboardPage />} />
      <Route path="/targets" element={<TargetsPage />} />
      <Route path="/sequences" element={<SequencesPage />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/apps" element={<AppsPage />} />
      <Route path="/enterprise" element={<EnterprisePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AdminRoutes({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Routes>
      <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
      <Route path="/admin/*" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [isAdmin, setIsAdmin] = useState(false);
  const [enterpriseBadge, setEnterpriseBadge] = useState<string | null>(null);
  const [isOwnerLikeAccount, setIsOwnerLikeAccount] = useState(false);
  const [isEnterpriseParticipantAccount, setIsEnterpriseParticipantAccount] = useState(false);
  const [userName, setUserName] = useState("Northstone user");
  const [userRole, setUserRole] = useState("CRM access");
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
        setIsOwnerLikeAccount(false);
        setIsEnterpriseParticipantAccount(false);
        setUserName("Northstone user");
        setUserRole("CRM access");
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
      setIsOwnerLikeAccount(false);
      setIsEnterpriseParticipantAccount(false);
      setUserName("Northstone user");
      setUserRole("CRM access");
      setReraCompleted(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const me = await api<MeResponse>("/auth/me");
        if (cancelled) return;

        const plan = (me.plan || "free").toLowerCase();
        const memberRole = (me.enterprise_member_role || "").toLowerCase();
        const ownerMode = plan === "enterprise" || plan === "builder";
        const derivedBadge =
          me.enterprise_company_name?.trim() ||
          (plan === "builder"
            ? "Builder"
            : ownerMode
              ? "Enterprise"
              : memberRole === "broker"
                ? "Broker"
                : memberRole === "cp"
                  ? "CP"
                  : null);

        setIsAdmin(Boolean(me.is_admin));
        setEnterpriseBadge(derivedBadge);
        setIsOwnerLikeAccount(ownerMode);
        setIsEnterpriseParticipantAccount(ownerMode || Boolean(me.enterprise_owner_id));
        setUserName(me.full_name?.trim() || getEmail() || me.email || "Northstone user");
        setUserRole(
          me.is_admin
            ? "Admin"
            : plan === "builder"
              ? "Builder owner"
              : plan === "enterprise"
                ? memberRole
                  ? memberRole.replace(/_/g, " ")
                  : "Enterprise owner"
                : "Solo closer"
        );
        setReraCompleted(Boolean(me.is_admin || me.rera_completed));
      } catch {
        if (cancelled) return;
        setIsAdmin(false);
        setEnterpriseBadge(null);
        setIsOwnerLikeAccount(false);
        setIsEnterpriseParticipantAccount(false);
        setUserName(getEmail() || "Northstone user");
        setUserRole("CRM access");
        setReraCompleted(true);
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
    setIsOwnerLikeAccount(false);
        setIsEnterpriseParticipantAccount(false);
    setUserName("Northstone user");
    setUserRole("CRM access");
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
      if (adminIdleTimerRef.current) {
        window.clearTimeout(adminIdleTimerRef.current);
      }
      adminIdleTimerRef.current = window.setTimeout(() => {
        clearSession();
        setAuthed(false);
        setIsAdmin(false);
        setEnterpriseBadge(null);
        setUserName("Northstone user");
        setUserRole("CRM access");
        setReraCompleted(true);
        navigate("/login");
      }, 30 * 60 * 1000);
    };

    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((eventName) => window.addEventListener(eventName, resetAdminIdleTimer, { passive: true }));
    resetAdminIdleTimer();

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, resetAdminIdleTimer));
      if (adminIdleTimerRef.current) {
        window.clearTimeout(adminIdleTimerRef.current);
      }
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

  const isOwnerLike = isAdmin || isOwnerLikeAccount;
  const isEnterpriseParticipant = isOwnerLike || isEnterpriseParticipantAccount;
  const isAdminRoute = location.pathname.startsWith("/admin");

  if (isAdminRoute) {
    return (
      <AdminShell onLogout={handleLogout}>
        <AdminRoutes isAdmin={isAdmin} />
      </AdminShell>
    );
  }

  return (
    <AppShell
      isAdmin={isAdmin}
      isOwnerLike={isOwnerLike}
      isEnterpriseParticipant={isEnterpriseParticipant}
      userName={userName}
      userRole={isAdmin ? "Admin" : enterpriseBadge ? `${enterpriseBadge} workspace` : userRole}
      onLogout={handleLogout}
    >
      <CrmRoutes isAdmin={isAdmin} />
      <TutorialBubble isAdmin={isAdmin} reraCompleted={reraCompleted || isAdmin} email={getEmail() || ""} />
    </AppShell>
  );
}
