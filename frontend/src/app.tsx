import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api/client";
import { clearSession, getEmail, getToken, hasKnownAccount } from "./auth";
import TutorialBubble from "./components/TutorialBubble";
import AdminPage from "./pages/AdminPage";
import { AdminOwnerContactsPage, AdminOwnerDealsPage, AdminOwnerPipelinePage } from "./pages/AdminWorkspacePages";
import AccountPage from "./pages/AccountPage";
import AppsPage from "./pages/AppsPage";
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
import type { Deal, Stage } from "./api/types";

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
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">
          <img src="/northstone-logo-icon.png" alt="Northstone logo" className="logoMark" />
        </div>
        <div>
          <div className="brandTitle">Northstone</div>
          <div className="brandSub">
            Pipeline | Grid | ROI
          </div>
        </div>
        {isAdmin ? <div className="pill adminPill">Admin</div> : null}
        {enterpriseBadge ? <div className="pill enterprisePill">{enterpriseBadge}</div> : null}
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

const PREVIEW_STAGES: Stage[] = ["lead", "visit", "negotiation", "closed", "lost"];

const PREVIEW_DEALS: Deal[] = [
  {
    id: "preview-1",
    title: "Northstone Residences | 3 BHK upgrade buyer",
    asset_type: "residential",
    stage: "lead",
    city: "Pune",
    area: "Baner",
    visit_date: null,
    typology: "3 BHK",
    ticket_size: 16500000,
    customer_budget: 17000000,
    expected_yield_pct: 6.8,
    expected_roi_pct: 18,
    liquidity_days_est: 75,
    client_phase: "warm",
    close_probability: 35,
    risk_flags: "",
    contact_id: null,
    notes: "",
    last_activity_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "preview-2",
    title: "Commercial investor | tower frontage shop",
    asset_type: "commercial",
    stage: "visit",
    city: "Mumbai",
    area: "Thane",
    visit_date: null,
    typology: "Retail",
    ticket_size: 9800000,
    customer_budget: 11000000,
    expected_yield_pct: 8.4,
    expected_roi_pct: 15,
    liquidity_days_est: 90,
    client_phase: "hot",
    close_probability: 60,
    risk_flags: "",
    contact_id: null,
    notes: "",
    last_activity_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "preview-3",
    title: "Builder bulk channel partner allocation",
    asset_type: "land",
    stage: "negotiation",
    city: "Pune",
    area: "Hinjewadi",
    visit_date: null,
    typology: "Project block",
    ticket_size: 45000000,
    customer_budget: 50000000,
    expected_yield_pct: 7.2,
    expected_roi_pct: 22,
    liquidity_days_est: 120,
    client_phase: "hot",
    close_probability: 72,
    risk_flags: "",
    contact_id: null,
    notes: "",
    last_activity_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "preview-4",
    title: "Corporate housing relocation mandate",
    asset_type: "residential",
    stage: "closed",
    city: "Bengaluru",
    area: "Whitefield",
    visit_date: null,
    typology: "4 BHK",
    ticket_size: 23200000,
    customer_budget: 24000000,
    expected_yield_pct: 5.9,
    expected_roi_pct: 14,
    liquidity_days_est: 65,
    client_phase: "hot",
    close_probability: 100,
    risk_flags: "",
    contact_id: null,
    notes: "",
    last_activity_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

function stageLabel(stage: Stage) {
  switch (stage) {
    case "lead":
      return "Lead";
    case "visit":
      return "Visit";
    case "negotiation":
      return "Negotiation";
    case "closed":
      return "Closed";
    case "lost":
      return "Lost";
  }
}

function PreviewPipelinePage() {
  const byStage = useMemo(() => {
    const map = new Map<Stage, Deal[]>();
    for (const stage of PREVIEW_STAGES) map.set(stage, []);
    for (const deal of PREVIEW_DEALS) map.get(deal.stage)?.push(deal);
    return map;
  }, []);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Pipeline preview</div>
          <div className="muted">This is the public CRM preview. The pipeline is live to explore before sign-in.</div>
        </div>
        <div className="row">
          <NavLink className="btn" to="/login">
            Login to full CRM
          </NavLink>
          <a className="btn ghost" href="https://northstonecrm.com/#start">
            Start a subscription
          </a>
        </div>
      </div>

      <section className="card previewHeroCard">
        <div className="cardTitle">What you can do here</div>
        <div className="mini previewBulletGrid">
          <div>Preview the CRM structure with every major feature visible.</div>
          <div>Explore a working pipeline board before committing to the system.</div>
          <div>Unlock deals, contacts, insights, enterprise tools, apps, and admin after sign-in and the right subscription.</div>
        </div>
      </section>

      <div className="kanban">
        {PREVIEW_STAGES.map((stage) => (
          <div key={stage} className="col">
            <div className="colHeader">
              <div className="colTitle">{stageLabel(stage)}</div>
              <div className="count">{byStage.get(stage)?.length ?? 0}</div>
            </div>
            <div className="colBody">
              {(byStage.get(stage) ?? []).map((deal) => (
                <PreviewDealCard key={deal.id} deal={deal} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function previewMoney(value: number | null) {
  if (value == null) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function PreviewDealCard({ deal }: { deal: Deal }) {
  return (
    <div className="dealCard previewDealCard" aria-label={`${deal.title} preview`}>
      <div className="dcTop">
        <div className="dcTitle">{deal.title}</div>
        <div className="pill">{deal.asset_type}</div>
      </div>
      <div className="dcMeta">
        <div className="muted">
          {deal.area || "Area"}
          {deal.city ? `, ${deal.city}` : ""}
        </div>
        <div className="muted">Rs {previewMoney(deal.ticket_size)}</div>
      </div>
      <div className="dcBottom">
        <div className="mini">
          Close: <b>{deal.close_probability ?? "-"}%</b>
        </div>
        <div className="mini">
          Yield: <b>{deal.expected_yield_pct ?? "-"}%</b>
        </div>
      </div>
      <div className="previewDealLock">Deal detail stays locked in preview</div>
    </div>
  );
}

function PreviewLockedPage({
  title,
  description,
  featurePoints,
  upgradeLabel = "Unlock with subscription"
}: {
  title: string;
  description: string;
  featurePoints: string[];
  upgradeLabel?: string;
}) {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">{title}</div>
          <div className="muted">{description}</div>
        </div>
      </div>

      <section className="card previewLockedCard">
        <div className="cardTitle">{upgradeLabel}</div>
        <div className="cardText">
          This page stays visible in the preview CRM so prospects can understand the full workspace. Sign in and subscribe to make it operational.
        </div>
        <div className="list" style={{ marginTop: 18 }}>
          {featurePoints.map((point) => (
            <div className="listRow" key={point}>
              <span className="tick">+</span>
              <span>{point}</span>
            </div>
          ))}
        </div>
        <div className="heroActions previewActions">
          <NavLink className="btn" to="/login">
            Login
          </NavLink>
          <a className="btn ghost" href="https://northstonecrm.com/#pricing">
            View plans
          </a>
        </div>
      </section>
    </div>
  );
}

function PreviewApp() {
  const location = useLocation();
  const showBottomNav = !location.pathname.startsWith("/enterprise") && !location.pathname.startsWith("/admin");

  return (
    <div className="appShell">
      <TopBar isAdmin={false} enterpriseBadge={null} loginHref="/login" />
      <main className="content">
        <Routes>
          <Route path="/" element={<PreviewPipelinePage />} />
          <Route
            path="/today"
            element={
              <PreviewLockedPage
                title="Today"
                description="Daily actions, reminders, and follow-up orchestration."
                featurePoints={["Upcoming and overdue activity lists", "AI follow-up drafting", "WhatsApp and task execution flow"]}
              />
            }
          />
          <Route
            path="/deals"
            element={
              <PreviewLockedPage
                title="Deals"
                description="Grid, export, and deal-level drilldown."
                featurePoints={["Deal grid and filtering", "CSV export and reporting", "Detailed per-deal execution view"]}
              />
            }
          />
          <Route path="/deals/:dealId" element={<PreviewLockedPage title="Deal detail" description="Deal-level detail, activity, and intelligence." featurePoints={["Deal memo and notes", "Follow-up history", "Predictive support and reporting"]} />} />
          <Route path="/contacts" element={<PreviewLockedPage title="Contacts" description="Client, investor, and channel partner records." featurePoints={["Contact list and notes", "Role tags and segmentation", "Contact exports and follow-up visibility"]} />} />
          <Route path="/calc" element={<PreviewLockedPage title="ROI" description="Return, yield, and asset evaluation tooling." featurePoints={["ROI calculators", "Yield and budget comparisons", "Deal-side investment framing"]} />} />
          <Route path="/insights" element={<PreviewLockedPage title="Insights" description="Sales intelligence, performance trends, and reporting." featurePoints={["Performance summaries", "Stage movement signals", "Organization and seller insights"]} />} />
          <Route path="/enterprise" element={<PreviewLockedPage title="Enterprise" description="Owner controls, teams, builder workflows, and org-level visibility." featurePoints={["Employee hierarchy and owner controls", "Builder document workflows", "Audit, analytics, and support visibility"]} />} />
          <Route path="/account" element={<PreviewLockedPage title="Account" description="Personal workspace profile and ownership details." featurePoints={["Profile management", "Subscription ownership overview", "Access and enterprise inheritance details"]} />} />
          <Route path="/settings" element={<PreviewLockedPage title="Settings" description="AI access, app install, and system preferences." featurePoints={["Assigned AI access testing", "Owner-only CRM install access", "Admin runtime controls after login"]} />} />
          <Route path="/apps" element={<PreviewLockedPage title="Apps" description="Google Workspace, Zoom, ads, and future integrations." featurePoints={["Google Workspace and Zoom connections", "Ads launch shortcuts", "Owner-managed integrations for paid orgs"]} />} />
          <Route path="/admin" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TutorialBubble isAdmin={false} isEnterprise={true} reraCompleted={false} email="" />
      {showBottomNav ? <BottomNav /> : null}
    </div>
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
      if ((e.key === "northstonecrm_token" || e.key === "dealios_token") && !e.newValue) {
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
          enterprise_member_role?: string;
          rera_completed?: boolean;
        }>("/auth/me");
        if (!cancelled) {
          setIsAdmin(Boolean(me.is_admin));
          const plan = (me.plan || "free").toLowerCase();
          const ownerMode = plan === "enterprise" || plan === "builder";
          const memberRole = (me.enterprise_member_role || "").toLowerCase();
          const memberMode = Boolean(me.enterprise_owner_id) && (memberRole === "broker" || memberRole === "cp");
          setIsEnterprise(ownerMode || memberMode);
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
    navigate("/login");
  }

  if (!authed) {
    if (location.pathname === "/login" || hasKnownAccount()) {
      return (
        <LoginPage
          onLoggedIn={async () => {
            setAuthed(true);
          }}
        />
      );
    }
    return <PreviewApp />;
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
        isEnterprise={isEnterprise}
        reraCompleted={reraCompleted || isAdmin}
        email={getEmail() || ""}
      />
      {showBottomNav ? <BottomNav /> : null}
    </div>
  );
}
