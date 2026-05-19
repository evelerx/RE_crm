import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Activity, Contact, Deal, Profile, Stage } from "../src/api/types";

type DemoState = {
  deals: Deal[];
  contacts: Contact[];
  activities: Activity[];
  profile: Profile;
};

type LockedNotice = {
  title: string;
  message: string;
};

const DEMO_STORAGE_KEY = "northstone_demo_session";
const STAGES: Stage[] = ["lead", "visit", "negotiation", "closed", "lost"];

function nowIso() {
  return new Date().toISOString();
}

function demoId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function seedState(): DemoState {
  const createdAt = nowIso();
  const profile: Profile = {
    id: demoId("profile"),
    owner_id: demoId("owner"),
    full_name: "Northstone Demo User",
    phone: "9876543210",
    whatsapp: "9876543210",
    company: "Northstone Demo Realty",
    city: "Pune",
    areas_served: "Baner, Hinjewadi, Kharadi",
    specialization: "residential",
    rera_id: "",
    pan: "",
    gstin: "",
    languages: "English, Hindi",
    bio: "Demo workspace for showcasing the CRM experience without login.",
    created_at: createdAt,
    updated_at: createdAt
  };

  const contacts: Contact[] = [
    {
      id: demoId("contact"),
      name: "Shlok",
      occupation: "Buyer",
      phone: null,
      email: null,
      role: "buyer",
      tags: "premium,budget-ready",
      notes: "Interested in 3 BHK inventory in Pune west.",
      created_at: createdAt,
      updated_at: createdAt
    },
    {
      id: demoId("contact"),
      name: "Aarav Ventures",
      occupation: "Investor",
      phone: "9876543210",
      email: "aarav@example.com",
      role: "investor",
      tags: "investor,commercial",
      notes: "Looks at yield-first opportunities.",
      created_at: createdAt,
      updated_at: createdAt
    },
    {
      id: demoId("contact"),
      name: "Builder Org",
      occupation: "Developer",
      phone: "8765432109",
      email: "builder@example.com",
      role: "seller",
      tags: "builder,launch",
      notes: "Launch support and document workflows.",
      created_at: createdAt,
      updated_at: createdAt
    }
  ];

  const deals: Deal[] = [
    {
      id: demoId("deal"),
      title: "Residency Phase 2 | 3 BHK buyer",
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
      contact_id: contacts[0].id,
      notes: "Buyer wants premium clubhouse and fast possession options.",
      last_activity_at: createdAt,
      created_at: createdAt,
      updated_at: createdAt
    },
    {
      id: demoId("deal"),
      title: "Commercial frontage shop investor",
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
      contact_id: contacts[1].id,
      notes: "Investor wants clearer lease assumptions.",
      last_activity_at: createdAt,
      created_at: createdAt,
      updated_at: createdAt
    },
    {
      id: demoId("deal"),
      title: "Builder launch allocation block",
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
      contact_id: contacts[2].id,
      notes: "Needs launch workflow coordination and inventory plan.",
      last_activity_at: createdAt,
      created_at: createdAt,
      updated_at: createdAt
    }
  ];

  const activities: Activity[] = [
    {
      id: demoId("activity"),
      deal_id: deals[0].id,
      contact_id: deals[0].contact_id,
      kind: "whatsapp",
      summary: "Sent premium layout options and scheduled follow-up.",
      due_at: null,
      completed: false,
      created_at: createdAt
    },
    {
      id: demoId("activity"),
      deal_id: deals[1].id,
      contact_id: deals[1].contact_id,
      kind: "meeting",
      summary: "Yield discussion with investor team.",
      due_at: null,
      completed: true,
      created_at: createdAt
    }
  ];

  return { deals, contacts, activities, profile };
}

function loadDemoState(): DemoState {
  try {
    const raw = sessionStorage.getItem(DEMO_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DemoState;
  } catch {
    // ignore
  }
  return seedState();
}

function saveDemoState(state: DemoState) {
  sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
}

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

function formatMoney(value: number | null | undefined) {
  if (value == null) return "-";
  return `Rs ${Math.round(value).toLocaleString("en-IN")}`;
}

function DemoTopBar() {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">
          <img src="/northstone-mark.svg" alt="Northstone logo" className="logoMark" />
        </div>
        <div>
          <div className="brandTitle">Northstone</div>
          <div className="brandSub">
            Demo CRM experience <span className="brandBy">session-only workspace</span>
          </div>
        </div>
        <div className="pill enterprisePill">Demo</div>
      </div>
      <nav className="navDesktop">
        <NavLink to="/today" className={({ isActive }) => (isActive ? "navA active" : "navA")}>Today</NavLink>
        <NavLink to="/" end className={({ isActive }) => (isActive ? "navA active" : "navA")}>Pipeline</NavLink>
        <NavLink to="/deals" className={({ isActive }) => (isActive ? "navA active" : "navA")}>Deals</NavLink>
        <NavLink to="/contacts" className={({ isActive }) => (isActive ? "navA active" : "navA")}>Contacts</NavLink>
        <NavLink to="/calc" className={({ isActive }) => (isActive ? "navA active" : "navA")}>ROI</NavLink>
        <NavLink to="/insights" className={({ isActive }) => (isActive ? "navA active" : "navA")}>Insights</NavLink>
        <NavLink to="/enterprise" className={({ isActive }) => (isActive ? "navA active" : "navA")}>Enterprise</NavLink>
        <NavLink to="/account" className={({ isActive }) => (isActive ? "navA active" : "navA")}>Account</NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "navA active" : "navA")}>Settings</NavLink>
        <NavLink to="/apps" className={({ isActive }) => (isActive ? "navA active" : "navA")}>Apps</NavLink>
        <NavLink to="/admin" className={({ isActive }) => (isActive ? "navA active" : "navA")}>Admin</NavLink>
      </nav>
    </header>
  );
}

function DemoBottomNav() {
  return (
    <nav className="bottomNav">
      <NavLink to="/today" className={({ isActive }) => (isActive ? "bn active" : "bn")}>Today</NavLink>
      <NavLink to="/" end className={({ isActive }) => (isActive ? "bn active" : "bn")}>Pipeline</NavLink>
      <NavLink to="/deals" className={({ isActive }) => (isActive ? "bn active" : "bn")}>Deals</NavLink>
      <NavLink to="/contacts" className={({ isActive }) => (isActive ? "bn active" : "bn")}>Contacts</NavLink>
      <NavLink to="/calc" className={({ isActive }) => (isActive ? "bn active" : "bn")}>ROI</NavLink>
    </nav>
  );
}

function DemoBanner() {
  return (
    <section className="card previewHeroCard" style={{ marginBottom: 18 }}>
      <div className="cardTitle">Demo website CRM</div>
      <div className="mini previewBulletGrid">
        <div>Pipeline, Deals, and Contacts are fully interactive for this browser session.</div>
        <div>All other pages show launch-soon messaging while keeping the full CRM structure visible.</div>
        <div>Session data is temporary and clears when this browser session ends.</div>
      </div>
    </section>
  );
}

function LockedModal({ notice, onClose }: { notice: LockedNotice | null; onClose: () => void }) {
  if (!notice) return null;
  return (
    <div className="upgradePrompt" aria-live="polite">
      <button className="upgradePromptClose" type="button" onClick={onClose} aria-label="Close launch prompt">
        ×
      </button>
      <div className="upgradePromptTitle">{notice.title}</div>
      <div className="upgradePromptText">{notice.message}</div>
      <div className="upgradePromptActions">
        <button className="btn ghost" type="button" onClick={onClose}>
          Close
        </button>
        <a className="btn" href="https://northstonecrm.com" target="_blank" rel="noreferrer">
          Open official website
        </a>
      </div>
    </div>
  );
}

function LockedFeaturePage({
  title,
  description,
  showNotice,
}: {
  title: string;
  description: string;
  showNotice: (title: string, message?: string) => void;
}) {
  useEffect(() => {
    showNotice(title);
  }, [showNotice, title]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">{title}</div>
          <div className="muted">{description}</div>
        </div>
      </div>
      <section className="card previewLockedCard">
        <div className="cardTitle">Demo website notice</div>
        <div className="cardText">
          This is a demo website. This feature is fully functional on the official Northstone CRM and will be launching here soon.
        </div>
        <div className="heroActions previewActions">
          <a className="btn" href="https://northstonecrm.com" target="_blank" rel="noreferrer">
            Visit official website
          </a>
          <button className="btn ghost" type="button" onClick={() => showNotice(title)}>
            Show notice again
          </button>
        </div>
      </section>
    </div>
  );
}

function PreviewActionRow({
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  primaryLabel: string;
  secondaryLabel?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
}) {
  return (
    <div className="row">
      <button className="btn" type="button" onClick={onPrimary}>
        {primaryLabel}
      </button>
      {secondaryLabel && onSecondary ? (
        <button className="btn ghost" type="button" onClick={onSecondary}>
          {secondaryLabel}
        </button>
      ) : null}
    </div>
  );
}

function TodayPreviewPage({ showNotice }: { showNotice: (title: string, message?: string) => void }) {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Today</div>
          <div className="muted">Daily priorities, reminders, stuck deals, and AI follow-up execution.</div>
        </div>
        <button className="btn ghost" type="button" onClick={() => showNotice("Today refresh")}>
          Refresh
        </button>
      </div>
      <DemoBanner />
      <div className="detailGrid">
        <section className="card premiumPanel">
          <div className="cardTitle">AI follow-up queue</div>
          <div className="list">
            <div className="listItem">
              <div><b>Shlok (buyer)</b></div>
              <div className="muted small">Residency Phase 2 | warm lead | follow-up due today</div>
              <textarea className="textarea" readOnly value="I hope this message finds you well. Following up regarding the updated layout and next steps for your visit." />
              <PreviewActionRow
                primaryLabel="Generate"
                secondaryLabel="Send on WhatsApp"
                onPrimary={() => showNotice("AI Follow-up")}
                onSecondary={() => showNotice("WhatsApp send")}
              />
            </div>
          </div>
        </section>
        <section className="card">
          <div className="cardTitle">Activities</div>
          <div className="list">
            <div className="listItem">
              <div className="muted">Meeting | 19/5/2026, 2:53:54 pm</div>
              <div className="row">
                <div className="grow">Meet investor team for yield review.</div>
                <button className="btn" type="button" onClick={() => showNotice("Activity update")}>
                  Mark done
                </button>
              </div>
            </div>
            <div className="listItem">
              <div className="muted">Reminder | due tomorrow</div>
              <div className="row">
                <div className="grow">Push builder launch draft for approval.</div>
                <button className="btn ghost" type="button" onClick={() => showNotice("Reminder action")}>
                  Open
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function RoiPreviewPage() {
  const [buyPrice, setBuyPrice] = useState("10000000");
  const [rentMonthly, setRentMonthly] = useState("40000");
  const [annualCosts, setAnnualCosts] = useState("60000");
  const [sellPrice, setSellPrice] = useState("12000000");
  const [holdYears, setHoldYears] = useState("2");

  const out = useMemo(() => {
    const buy = Number(buyPrice) || 0;
    const rent = Number(rentMonthly) || 0;
    const costs = Number(annualCosts) || 0;
    const sell = Number(sellPrice) || 0;
    const years = Math.max(1, Math.floor(Number(holdYears) || 1));
    const annualRent = rent * 12;
    const netAnnual = annualRent - costs;
    const yieldPct = buy > 0 ? (netAnnual / buy) * 100 : 0;
    const totalNetRent = netAnnual * years;
    const flipProfit = sell - buy;
    const totalProfit = totalNetRent + flipProfit;
    const roiPct = buy > 0 ? (totalProfit / buy) * 100 : 0;
    return { annualRent, netAnnual, yieldPct, totalNetRent, flipProfit, totalProfit, roiPct, years };
  }, [annualCosts, buyPrice, holdYears, rentMonthly, sellPrice]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">ROI Calculator</div>
          <div className="muted">Estimate rental yield, hold profit, and resale upside before you push a deal forward.</div>
        </div>
      </div>
      <DemoBanner />
      <div className="calcGrid">
        <section className="card">
          <div className="cardTitle">Inputs</div>
          <div className="form">
            <label>Buy Price (Rs)<input inputMode="numeric" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} /></label>
            <label>Monthly Rent (Rs)<input inputMode="numeric" value={rentMonthly} onChange={(e) => setRentMonthly(e.target.value)} /></label>
            <label>Annual Costs (Rs)<input inputMode="numeric" value={annualCosts} onChange={(e) => setAnnualCosts(e.target.value)} /></label>
            <label>Sell Price (Rs)<input inputMode="numeric" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} /></label>
            <label>Hold Period (years)<input inputMode="numeric" value={holdYears} onChange={(e) => setHoldYears(e.target.value)} /></label>
          </div>
        </section>
        <section className="card premiumPanel">
          <div className="cardTitle">Results</div>
          <div className="kv">
            <div className="k">Annual Rent</div><div className="v">{formatMoney(out.annualRent)}</div>
            <div className="k">Net Annual Income</div><div className="v">{formatMoney(out.netAnnual)}</div>
            <div className="k">Rental Yield</div><div className="v">{out.yieldPct.toFixed(2)}%</div>
            <div className="k">Hold Period</div><div className="v">{out.years} year(s)</div>
            <div className="k">Total Net Rent</div><div className="v">{formatMoney(out.totalNetRent)}</div>
            <div className="k">Resale Profit</div><div className="v">{formatMoney(out.flipProfit)}</div>
            <div className="k">Total Profit</div><div className="v">{formatMoney(out.totalProfit)}</div>
            <div className="k">ROI</div><div className="v">{out.roiPct.toFixed(2)}%</div>
          </div>
        </section>
      </div>
    </div>
  );
}

function InsightsPreviewPage({ showNotice }: { showNotice: (title: string, message?: string) => void }) {
  const summary = {
    open_pipeline_value: 71300000,
    weighted_open_pipeline_value: 48600000,
    followup_completion_rate_7d: 0.74,
    completed_activities_7d: 17,
    activities_7d: 23,
    avg_close_probability_open: 56,
    total_deals: 24,
    win_rate: 0.28,
    stuck_deals: 5,
    overdue_reminders: 4,
    upcoming_reminders_3d: 7,
    lead_to_close_rate: 0.18,
    visit_to_negotiation_rate: 0.42,
  };
  const stages = [
    { stage: "lead", count: 9 },
    { stage: "visit", count: 6 },
    { stage: "negotiation", count: 5 },
    { stage: "closed", count: 3 },
    { stage: "lost", count: 1 },
  ];
  const transitions = [
    { from: "lead", to: "visit", count: 8 },
    { from: "visit", to: "negotiation", count: 5 },
    { from: "negotiation", to: "closed", count: 3 },
  ];
  const leaderboard = [
    { name: "Northstone Demo User", email: "owner@northstonecrm.com", role: "Owner", deals: 11, closed: 2, activities: 9, pipeline: 32800000 },
    { name: "Builder Demo Rep", email: "builder@northstonecrm.com", role: "Builder", deals: 7, closed: 1, activities: 8, pipeline: 21400000 },
    { name: "Broker Demo Rep", email: "broker@northstonecrm.com", role: "Broker", deals: 6, closed: 0, activities: 6, pipeline: 17100000 },
  ];

  const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Insights</div>
          <div className="muted">Manager view for pipeline value, conversion momentum, and execution discipline.</div>
        </div>
        <button className="btn ghost" type="button" onClick={() => showNotice("Insights refresh")}>
          Refresh
        </button>
      </div>
      <DemoBanner />
      <div className="detailGrid">
        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="cardTitle">Revenue view</div>
          <div className="statsGrid">
            <div className="statCard">
              <div className="statLabel">Open pipeline</div>
              <div className="statValue">{formatMoney(summary.open_pipeline_value)}</div>
              <div className="statHint">Live value still being worked by the team.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Weighted pipeline</div>
              <div className="statValue">{formatMoney(summary.weighted_open_pipeline_value)}</div>
              <div className="statHint">Risk-adjusted pipeline based on current close probability.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Follow-up completion</div>
              <div className="statValue">{pct(summary.followup_completion_rate_7d)}</div>
              <div className="statHint">{summary.completed_activities_7d} completed out of {summary.activities_7d} activities in the last 7 days.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Avg close probability</div>
              <div className="statValue">{summary.avg_close_probability_open}%</div>
              <div className="statHint">Average confidence across all open deals.</div>
            </div>
          </div>
        </section>
        <section className="card">
          <div className="cardTitle">KPI</div>
          <div className="kv">
            <div className="k">Deals</div><div className="v">{summary.total_deals}</div>
            <div className="k">Win rate</div><div className="v">{pct(summary.win_rate)}</div>
            <div className="k">Stuck (7d)</div><div className="v">{summary.stuck_deals}</div>
            <div className="k">Overdue</div><div className="v">{summary.overdue_reminders}</div>
            <div className="k">Upcoming (3d)</div><div className="v">{summary.upcoming_reminders_3d}</div>
            <div className="k">Activities (7d)</div><div className="v">{summary.activities_7d}</div>
            <div className="k">Lead to close</div><div className="v">{pct(summary.lead_to_close_rate)}</div>
            <div className="k">Visit to negotiation</div><div className="v">{pct(summary.visit_to_negotiation_rate)}</div>
          </div>
        </section>
        <section className="card">
          <div className="cardTitle">Pipeline</div>
          <div className="kv">
            {stages.map((s) => (
              <div key={s.stage} className="row" style={{ justifyContent: "space-between" }}>
                <div className="k" style={{ width: 140, textTransform: "capitalize" }}>{s.stage}</div>
                <div className="v">{s.count}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="cardTitle">Top stage moves (30 days)</div>
          <div className="tableWrap">
            <table className="table">
              <thead><tr><th>From</th><th>To</th><th>Count</th></tr></thead>
              <tbody>
                {transitions.map((t) => (
                  <tr key={`${t.from}-${t.to}`}>
                    <td style={{ textTransform: "capitalize" }}>{t.from}</td>
                    <td style={{ textTransform: "capitalize" }}>{t.to}</td>
                    <td>{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="cardTitle">Team leaderboard</div>
          <div className="tableWrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Deals</th><th>Closed</th><th>Activities (7d)</th><th>Open pipeline</th></tr></thead>
              <tbody>
                {leaderboard.map((member) => (
                  <tr key={member.email}>
                    <td className="tdTitle">{member.name}</td>
                    <td>{member.email}</td>
                    <td>{member.role}</td>
                    <td>{member.deals}</td>
                    <td>{member.closed}</td>
                    <td>{member.activities}</td>
                    <td>{formatMoney(member.pipeline)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function EnterprisePreviewPage({ showNotice }: { showNotice: (title: string, message?: string) => void }) {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Organization</div>
          <div className="muted">Team management, builder operations, and rollups.</div>
        </div>
        <button className="btn ghost" type="button" onClick={() => showNotice("Enterprise refresh")}>
          Refresh
        </button>
      </div>
      <DemoBanner />
      <section className="card premiumPanel">
        <div className="cardTitle">Organization overview</div>
        <div className="statsGrid">
          <div className="statCard">
            <div className="statLabel">Owner</div>
            <div className="statValue">owner@northstonecrm.com</div>
            <div className="statHint">Northstone Demo Realty</div>
          </div>
          <div className="statCard">
            <div className="statLabel">Employee capacity</div>
            <div className="statValue">3/5</div>
            <div className="statHint">Team visibility and licensing control.</div>
          </div>
          <div className="statCard">
            <div className="statLabel">Combined deals</div>
            <div className="statValue">24</div>
            <div className="statHint">All employee pipeline rolled into one manager view.</div>
          </div>
          <div className="statCard">
            <div className="statLabel">Combined activities</div>
            <div className="statValue">33</div>
            <div className="statHint">Operational velocity across the enterprise team.</div>
          </div>
        </div>
      </section>
      <div className="detailGrid">
        <section className="card">
          <div className="cardTitle">Company setup</div>
          <div className="mini">
            <div><b>Company:</b> Northstone Demo Realty</div>
            <div><b>City:</b> Pune</div>
            <div><b>Areas served:</b> Baner, Hinjewadi, Kharadi</div>
            <div><b>Specialization:</b> residential + builder operations</div>
          </div>
          <PreviewActionRow
            primaryLabel="Save company setup"
            secondaryLabel="Manage employees"
            onPrimary={() => showNotice("Company setup")}
            onSecondary={() => showNotice("Employee management")}
          />
        </section>
        <section className="card">
          <div className="cardTitle">Builder and construction document desk</div>
          <div className="muted">Generate AI-drafted project overviews, sales offers, and company-facing construction summaries.</div>
          <div className="grid2">
            <label>Document type<select defaultValue="project_overview"><option value="project_overview">Project overview</option><option value="sales_offer">Sales offer</option></select></label>
            <label>Tone<select defaultValue="professional"><option value="professional">Professional</option><option value="premium">Premium</option></select></label>
          </div>
          <label>Project name<input defaultValue="Skyline Residency Phase 2" readOnly /></label>
          <label>Facts and instructions<textarea className="textarea" defaultValue="Write the exact facts, project details, construction status, approvals already available, target buyer, commercial points, and anything the draft must include." readOnly /></label>
          <PreviewActionRow
            primaryLabel="Generate AI draft"
            secondaryLabel="Save brief only"
            onPrimary={() => showNotice("Builder AI documents")}
            onSecondary={() => showNotice("Builder draft save")}
          />
        </section>
        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="cardTitle">Team leaderboard and governance</div>
          <div className="tableWrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Deals</th><th>Closed</th><th>Activities</th><th>Action</th></tr></thead>
              <tbody>
                {[
                  ["Northstone Demo User", "owner@northstonecrm.com", "Owner", 11, 2, 9],
                  ["Builder Demo Rep", "builder@northstonecrm.com", "Builder", 7, 1, 8],
                  ["Broker Demo Rep", "broker@northstonecrm.com", "Broker", 6, 0, 6],
                ].map(([name, email, role, deals, closed, activities]) => (
                  <tr key={String(email)}>
                    <td>{name}</td><td>{email}</td><td>{role}</td><td>{deals}</td><td>{closed}</td><td>{activities}</td>
                    <td><button className="btn ghost" type="button" onClick={() => showNotice("Governance actions")}>Manage</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function AppsPreviewPage({ showNotice }: { showNotice: (title: string, message?: string) => void }) {
  const [selectedTab, setSelectedTab] = useState<"communication" | "meetings" | "calendar" | "ads" | "coming_soon">("communication");
  const tabs = [
    { key: "communication", label: "Communication", iconUrl: "https://cdn.simpleicons.org/gmail/EA4335" },
    { key: "meetings", label: "Meetings", iconUrl: "https://cdn.simpleicons.org/googlemeet/00897B" },
    { key: "calendar", label: "Calendar", iconUrl: "https://cdn.simpleicons.org/googlecalendar/4285F4" },
    { key: "ads", label: "Ads", iconUrl: "https://cdn.simpleicons.org/googleads/4285F4" },
    { key: "coming_soon", label: "Coming soon", iconUrl: "https://cdn.simpleicons.org/clockify/03A9F4" },
  ] as const;
  const providerCards = [
    { name: "Gmail", tab: "communication", category: "Email", rollout: "Phase 1", purpose: "Send client follow-ups and log outbound communication to the CRM timeline.", iconUrl: "https://cdn.simpleicons.org/gmail/EA4335" },
    { name: "Google Meet", tab: "meetings", category: "Meetings", rollout: "Phase 1", purpose: "Generate meeting links for walkthroughs, client reviews, and partner calls from Northstone.", iconUrl: "https://cdn.simpleicons.org/googlemeet/00897B" },
    { name: "Google Calendar", tab: "calendar", category: "Scheduling", rollout: "Phase 1", purpose: "Create site visits, callbacks, launches, and review meetings from deal and contact context.", iconUrl: "https://cdn.simpleicons.org/googlecalendar/4285F4" },
  ];
  const ads = [
    { name: "Google Ads", desc: "Create campaigns for property launches, lead capture, project awareness, branded search, and location-targeted buyer demand.", iconUrl: "https://cdn.simpleicons.org/googleads/4285F4" },
    { name: "TikTok Ads", desc: "Promote projects, walkthroughs, and branded launch content with short-form campaign distribution for newer audiences.", iconUrl: "https://cdn.simpleicons.org/tiktok/000000" },
  ];
  const comingSoon = [
    { name: "Zoom", category: "Meetings", description: "Zoom meeting creation is already part of the official CRM rollout and will appear in this public demo soon.", iconUrl: "https://cdn.simpleicons.org/zoom/0B5CFF" },
    { name: "Meta Ads", category: "Ads", description: "Meta campaign launch surfaces are active in the official CRM path and will be connected into this demo soon.", iconUrl: "https://cdn.simpleicons.org/meta/0866FF" },
    { name: "Microsoft Teams", category: "Meetings", description: "Microsoft workspace rollout is prepared, but tenant and permission setup stays behind the official website flow.", iconUrl: "https://cdn.simpleicons.org/microsoftteams/6264A7" },
    { name: "Outlook", category: "Email", description: "Outlook support stays queued behind the same Microsoft tenant setup so mail and meeting workflows go live together.", iconUrl: "https://cdn.simpleicons.org/microsoftoutlook/0078D4" },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Apps</div>
          <div className="muted">Connection and publishing surfaces for communication, meetings, scheduling, and ads.</div>
        </div>
      </div>
      <DemoBanner />
      <div className="grid2" style={{ alignItems: "start" }}>
        <section className="card">
          <div className="cardTitle">Apps library</div>
          <div className="list">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={selectedTab === tab.key ? "btn" : "btn ghost"}
                onClick={() => setSelectedTab(tab.key)}
                style={{ justifyContent: "flex-start", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}
              >
                <img src={tab.iconUrl} alt={`${tab.label} icon`} style={{ width: 18, height: 18, borderRadius: 4, flex: "0 0 auto" }} />
                {tab.label}
              </button>
            ))}
          </div>
        </section>
        <div className="page">
          {providerCards.filter((card) => card.tab === selectedTab).map((card) => (
            <section key={card.name} className="card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="row" style={{ alignItems: "center", gap: 12 }}>
                  <img src={card.iconUrl} alt={`${card.name} icon`} style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.94)", padding: 4, flex: "0 0 auto" }} />
                  <div>
                    <div className="cardTitle">{card.name}</div>
                    <div className="muted">{card.category} | {card.rollout}</div>
                  </div>
                </div>
                <div className="pill">Ready to connect</div>
              </div>
              <div>{card.purpose}</div>
              <PreviewActionRow
                primaryLabel={`Connect ${card.name}`}
                secondaryLabel="Test connection"
                onPrimary={() => showNotice(card.name)}
                onSecondary={() => showNotice(`${card.name} test`)}
              />
            </section>
          ))}
          {selectedTab === "ads" ? ads.map((card) => (
            <section key={card.name} className="card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="row" style={{ alignItems: "center", gap: 12 }}>
                  <img src={card.iconUrl} alt={`${card.name} icon`} style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.94)", padding: 4, flex: "0 0 auto" }} />
                  <div>
                    <div className="cardTitle">{card.name}</div>
                    <div className="muted">Publish</div>
                  </div>
                </div>
                <div className="pill">Ready</div>
              </div>
              <div>{card.desc}</div>
              <button className="btn" type="button" onClick={() => showNotice(card.name)}>
                Open {card.name}
              </button>
            </section>
          )) : null}
          {selectedTab === "coming_soon" ? (
            <>
              {comingSoon.map((card) => (
                <section key={card.name} className="card">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div className="row" style={{ alignItems: "center", gap: 12 }}>
                      <img src={card.iconUrl} alt={`${card.name} icon`} style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.94)", padding: 4, flex: "0 0 auto" }} />
                      <div>
                        <div className="cardTitle">{card.name}</div>
                        <div className="muted">{card.category} | Coming soon</div>
                      </div>
                    </div>
                    <div className="pill">Coming soon</div>
                  </div>
                  <div>{card.description}</div>
                  <button className="btn ghost" type="button" onClick={() => showNotice(card.name)}>
                    Show demo notice
                  </button>
                </section>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PipelinePage({
  deals,
  contacts,
  addDeal,
}: {
  deals: Deal[];
  contacts: Contact[];
  addDeal: (payload: { title: string; city: string; area: string; stage: Stage; contactId: string }) => void;
}) {
  const [form, setForm] = useState({ title: "", city: "", area: "", stage: "lead" as Stage, contactId: "" });
  const byStage = useMemo(() => {
    const map = new Map<Stage, Deal[]>();
    STAGES.forEach((stage) => map.set(stage, []));
    deals.forEach((deal) => map.get(deal.stage)?.push(deal));
    return map;
  }, [deals]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Pipeline</div>
          <div className="muted">Interactive demo pipeline for this browser session.</div>
        </div>
      </div>
      <DemoBanner />
      <section className="card">
        <div className="cardTitle">Quick add deal</div>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.title.trim()) return;
            addDeal({
              title: form.title.trim(),
              city: form.city.trim(),
              area: form.area.trim(),
              stage: form.stage,
              contactId: form.contactId
            });
            setForm({ title: "", city: "", area: "", stage: "lead", contactId: "" });
          }}
        >
          <div className="grid2">
            <label>
              Deal title
              <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="New inventory opportunity" />
            </label>
            <label>
              Stage
              <select value={form.stage} onChange={(e) => setForm((prev) => ({ ...prev, stage: e.target.value as Stage }))}>
                {STAGES.map((stage) => (
                  <option key={stage} value={stage}>{stageLabel(stage)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid2">
            <label>
              Area
              <input value={form.area} onChange={(e) => setForm((prev) => ({ ...prev, area: e.target.value }))} placeholder="Baner" />
            </label>
            <label>
              City
              <input value={form.city} onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))} placeholder="Pune" />
            </label>
          </div>
          <label>
            Linked contact
            <select value={form.contactId} onChange={(e) => setForm((prev) => ({ ...prev, contactId: e.target.value }))}>
              <option value="">None selected</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>{contact.name}</option>
              ))}
            </select>
          </label>
          <div className="row right">
            <button className="btn" type="submit">Add deal</button>
          </div>
        </form>
      </section>
      <div className="kanban">
        {STAGES.map((stage) => (
          <div key={stage} className="col">
            <div className="colHeader">
              <div className="colTitle">{stageLabel(stage)}</div>
              <div className="count">{byStage.get(stage)?.length ?? 0}</div>
            </div>
            <div className="colBody">
              {(byStage.get(stage) ?? []).map((deal) => (
                <Link key={deal.id} to={`/deals/${deal.id}`} className="dealCard" style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="dcTop">
                    <div className="dcTitle">{deal.title}</div>
                    <div className="pill">{deal.asset_type}</div>
                  </div>
                  <div className="dcMeta">
                    <div className="muted">{deal.area || "-"}{deal.city ? `, ${deal.city}` : ""}</div>
                    <div className="muted">{formatMoney(deal.ticket_size)}</div>
                  </div>
                  <div className="dcBottom">
                    <div className="mini">Close: <b>{deal.close_probability ?? "-"}%</b></div>
                    <div className="mini">Contact: <b>{deal.contact_id ? "Linked" : "None"}</b></div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DealsPage({
  deals,
  deleteDeal,
}: {
  deals: Deal[];
  deleteDeal: (dealId: string) => void;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return deals;
    return deals.filter((deal) =>
      [deal.title, deal.city, deal.area, deal.typology, deal.stage, deal.client_phase, deal.asset_type].join(" ").toLowerCase().includes(needle)
    );
  }, [deals, q]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Deals</div>
          <div className="muted">Manage and inspect session-only demo deals.</div>
        </div>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deals" />
      </div>
      <DemoBanner />
      <div className="tableWrap tableWrapWide">
        <table className="table tableWide">
          <thead>
            <tr>
              <th>Title</th>
              <th>Stage</th>
              <th>Location</th>
              <th>Budget</th>
              <th>Ticket</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((deal) => (
              <tr key={deal.id}>
                <td className="tdTitle">{deal.title}</td>
                <td>{stageLabel(deal.stage)}</td>
                <td>{deal.area || "-"}{deal.city ? `, ${deal.city}` : ""}</td>
                <td>{formatMoney(deal.customer_budget)}</td>
                <td>{formatMoney(deal.ticket_size)}</td>
                <td>
                  <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                    <Link to={`/deals/${deal.id}`} className="btn ghost">Open</Link>
                    <button className="btn ghost" type="button" onClick={() => deleteDeal(deal.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="muted">No deals in this session.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContactsPage({
  contacts,
  deals,
  addContact,
  updateContact,
}: {
  contacts: Contact[];
  deals: Deal[];
  addContact: (payload: { name: string; phone: string; email: string; role: string; notes: string }) => void;
  updateContact: (contactId: string, patch: Partial<Contact>) => void;
}) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", role: "buyer", notes: "" });
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Contacts</div>
          <div className="muted">Session-only contact list with live edits.</div>
        </div>
      </div>
      <DemoBanner />
      <section className="card">
        <div className="cardTitle">Add contact</div>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            addContact(form);
            setForm({ name: "", phone: "", email: "", role: "buyer", notes: "" });
          }}
        >
          <div className="grid2">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Contact name" />
            </label>
            <label>
              Role
              <select value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}>
                <option value="buyer">Buyer</option>
                <option value="seller">Seller</option>
                <option value="investor">Investor</option>
                <option value="tenant">Tenant</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <div className="grid2">
            <label>
              Phone
              <input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="9876543210" />
            </label>
            <label>
              Email
              <input value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="lead@example.com" />
            </label>
          </div>
          <label>
            Notes
            <textarea className="textarea" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Budget, urgency, and context" />
          </label>
          <div className="row right">
            <button className="btn" type="submit">Add contact</button>
          </div>
        </form>
      </section>
      <div className="list">
        {contacts.map((contact) => {
          const linkedDeals = deals.filter((deal) => deal.contact_id === contact.id).length;
          const expanded = editingId === contact.id;
          return (
            <div key={contact.id} className="listItem">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                <div className="grow">
                  <div><b>{contact.name}</b> <span className="muted">({contact.role})</span></div>
                  <div className="muted small">{contact.phone || "-"}{contact.email ? ` | ${contact.email}` : ""} | linked deals: {linkedDeals}</div>
                  <div style={{ marginTop: 10 }}>{contact.notes || <span className="muted small">No notes yet.</span>}</div>
                </div>
                <button className="btn ghost" type="button" onClick={() => setEditingId(expanded ? null : contact.id)}>
                  {expanded ? "Close" : "Edit"}
                </button>
              </div>
              {expanded ? (
                <div className="form" style={{ marginTop: 14 }}>
                  <div className="grid2">
                    <label>
                      Name
                      <input value={contact.name} onChange={(e) => updateContact(contact.id, { name: e.target.value, updated_at: nowIso() })} />
                    </label>
                    <label>
                      Role
                      <input value={contact.role} onChange={(e) => updateContact(contact.id, { role: e.target.value, updated_at: nowIso() })} />
                    </label>
                  </div>
                  <label>
                    Notes
                    <textarea className="textarea" value={contact.notes} onChange={(e) => updateContact(contact.id, { notes: e.target.value, updated_at: nowIso() })} />
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DealDetailPage({
  state,
  updateDeal,
  addActivity,
  toggleActivity,
  showNotice,
}: {
  state: DemoState;
  updateDeal: (dealId: string, patch: Partial<Deal>) => void;
  addActivity: (payload: { deal_id: string; contact_id: string | null; kind: string; summary: string; due_at?: string | null }) => void;
  toggleActivity: (activityId: string) => void;
  showNotice: (title: string, message?: string) => void;
}) {
  const { dealId } = useParams();
  const deal = state.deals.find((row) => row.id === dealId);
  const contact = state.contacts.find((row) => row.id === deal?.contact_id);
  const activities = state.activities.filter((row) => row.deal_id === dealId);
  const [activityText, setActivityText] = useState("");
  const [followupDraft, setFollowupDraft] = useState("");

  if (!deal) {
    return <Navigate to="/deals" replace />;
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">{deal.title}</div>
          <div className="muted">{deal.asset_type} | {stageLabel(deal.stage)} | {deal.area || "-"}{deal.city ? `, ${deal.city}` : ""}</div>
        </div>
      </div>
      <DemoBanner />
      <section className="card premiumPanel">
        <div className="cardTitle">Deal snapshot</div>
        <div className="grid2">
          <label>
            Stage
            <select value={deal.stage} onChange={(e) => updateDeal(deal.id, { stage: e.target.value as Stage, updated_at: nowIso() })}>
              {STAGES.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}
            </select>
          </label>
          <label>
            Close probability
            <input
              inputMode="numeric"
              value={deal.close_probability ?? ""}
              onChange={(e) => updateDeal(deal.id, { close_probability: e.target.value ? Number(e.target.value) : null, updated_at: nowIso() })}
            />
          </label>
        </div>
        <div className="grid2">
          <label>
            Budget
            <input
              inputMode="numeric"
              value={deal.customer_budget ?? ""}
              onChange={(e) => updateDeal(deal.id, { customer_budget: e.target.value ? Number(e.target.value) : null, updated_at: nowIso() })}
            />
          </label>
          <label>
            Ticket size
            <input
              inputMode="numeric"
              value={deal.ticket_size ?? ""}
              onChange={(e) => updateDeal(deal.id, { ticket_size: e.target.value ? Number(e.target.value) : null, updated_at: nowIso() })}
            />
          </label>
        </div>
        <label>
          Notes
          <textarea className="textarea" value={deal.notes} onChange={(e) => updateDeal(deal.id, { notes: e.target.value, updated_at: nowIso() })} />
        </label>
        <div className="muted small">Linked contact: {contact ? `${contact.name} (${contact.role})` : "None selected"}</div>
      </section>
      <section className="card">
        <div className="cardTitle">AI follow-up</div>
        <div className="muted">Demo notice: AI actions here are intentionally locked for the public website preview.</div>
        <textarea className="textarea" value={followupDraft} onChange={(e) => setFollowupDraft(e.target.value)} placeholder="Type your own draft or click Generate to view the demo notice." />
        <div className="row">
          <button className="btn" type="button" onClick={() => showNotice("AI Follow-up", "This is a demo website. AI follow-up, WhatsApp execution, reminders, and scoring are functional in the official Northstone CRM and will be launching here soon.")}>
            Generate
          </button>
          <button className="btn ghost" type="button" onClick={() => showNotice("Send on WhatsApp")}>
            Send on WhatsApp
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              if (!followupDraft.trim()) return;
              addActivity({
                deal_id: deal.id,
                contact_id: deal.contact_id,
                kind: "whatsapp",
                summary: followupDraft.trim()
              });
              setFollowupDraft("");
            }}
          >
            Log activity
          </button>
          <button className="btn ghost" type="button" onClick={() => showNotice("Reminders")}>
            Remind in 2 days
          </button>
        </div>
      </section>
      <section className="card">
        <div className="cardTitle">Activities</div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!activityText.trim()) return;
            addActivity({
              deal_id: deal.id,
              contact_id: deal.contact_id,
              kind: "call",
              summary: activityText.trim()
            });
            setActivityText("");
          }}
        >
          <input className="input grow" value={activityText} onChange={(e) => setActivityText(e.target.value)} placeholder="Add an activity note..." />
          <button className="btn" type="submit">Add</button>
        </form>
        <div className="list">
          {activities.map((activity) => (
            <div key={activity.id} className="listItem">
              <div className="muted">{activity.kind} | {new Date(activity.created_at).toLocaleString()}</div>
              <div className="row">
                <div className="grow">{activity.summary}</div>
                <button className={activity.completed ? "btn ghost" : "btn"} type="button" onClick={() => toggleActivity(activity.id)}>
                  {activity.completed ? "Completed" : "Mark done"}
                </button>
              </div>
            </div>
          ))}
          {activities.length === 0 ? <div className="muted">No activities recorded yet.</div> : null}
        </div>
      </section>
    </div>
  );
}

export default function DemoApp() {
  const [state, setState] = useState<DemoState>(() => loadDemoState());
  const [notice, setNotice] = useState<LockedNotice | null>(null);
  const location = useLocation();

  useEffect(() => {
    saveDemoState(state);
  }, [state]);

  const showNotice = (title: string, message = "This is a demo website. This feature is functional in the official Northstone CRM and will be launching here soon.") => {
    setNotice({ title, message });
  };

  const addDeal = (payload: { title: string; city: string; area: string; stage: Stage; contactId: string }) => {
    const timestamp = nowIso();
    const next: Deal = {
      id: demoId("deal"),
      title: payload.title,
      asset_type: "residential",
      stage: payload.stage,
      city: payload.city,
      area: payload.area,
      visit_date: null,
      typology: "",
      ticket_size: null,
      customer_budget: null,
      expected_yield_pct: null,
      expected_roi_pct: null,
      liquidity_days_est: null,
      client_phase: "",
      close_probability: null,
      risk_flags: "",
      contact_id: payload.contactId || null,
      notes: "",
      last_activity_at: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    setState((prev) => ({ ...prev, deals: [next, ...prev.deals] }));
  };

  const updateDeal = (dealId: string, patch: Partial<Deal>) => {
    setState((prev) => ({
      ...prev,
      deals: prev.deals.map((deal) => (deal.id === dealId ? { ...deal, ...patch } : deal))
    }));
  };

  const deleteDeal = (dealId: string) => {
    const target = state.deals.find((deal) => deal.id === dealId);
    const confirmed = window.confirm(`Delete deal "${target?.title || "this deal"}" from this demo session?`);
    if (!confirmed) return;
    setState((prev) => ({
      ...prev,
      deals: prev.deals.filter((deal) => deal.id !== dealId),
      activities: prev.activities.filter((activity) => activity.deal_id !== dealId)
    }));
  };

  const addContact = (payload: { name: string; phone: string; email: string; role: string; notes: string }) => {
    const timestamp = nowIso();
    const next: Contact = {
      id: demoId("contact"),
      name: payload.name,
      occupation: "",
      phone: payload.phone || null,
      email: payload.email || null,
      role: payload.role,
      tags: "",
      notes: payload.notes,
      created_at: timestamp,
      updated_at: timestamp
    };
    setState((prev) => ({ ...prev, contacts: [next, ...prev.contacts] }));
  };

  const updateContact = (contactId: string, patch: Partial<Contact>) => {
    setState((prev) => ({
      ...prev,
      contacts: prev.contacts.map((contact) => (contact.id === contactId ? { ...contact, ...patch } : contact))
    }));
  };

  const addActivity = (payload: { deal_id: string; contact_id: string | null; kind: string; summary: string; due_at?: string | null }) => {
    const timestamp = nowIso();
    const next: Activity = {
      id: demoId("activity"),
      deal_id: payload.deal_id,
      contact_id: payload.contact_id,
      kind: payload.kind,
      summary: payload.summary,
      due_at: payload.due_at ?? null,
      completed: false,
      created_at: timestamp
    };
    setState((prev) => ({
      ...prev,
      activities: [next, ...prev.activities],
      deals: prev.deals.map((deal) => (deal.id === payload.deal_id ? { ...deal, last_activity_at: timestamp, updated_at: timestamp } : deal))
    }));
  };

  const toggleActivity = (activityId: string) => {
    setState((prev) => ({
      ...prev,
      activities: prev.activities.map((activity) => (activity.id === activityId ? { ...activity, completed: !activity.completed } : activity))
    }));
  };

  const showBottomNav = !location.pathname.startsWith("/enterprise") && !location.pathname.startsWith("/admin");

  return (
    <div className="appShell">
      <DemoTopBar />
      <main className="content">
        <Routes>
          <Route path="/" element={<PipelinePage deals={state.deals} contacts={state.contacts} addDeal={addDeal} />} />
          <Route path="/deals" element={<DealsPage deals={state.deals} deleteDeal={deleteDeal} />} />
          <Route path="/deals/:dealId" element={<DealDetailPage state={state} updateDeal={updateDeal} addActivity={addActivity} toggleActivity={toggleActivity} showNotice={showNotice} />} />
          <Route path="/contacts" element={<ContactsPage contacts={state.contacts} deals={state.deals} addContact={addContact} updateContact={updateContact} />} />
          <Route path="/today" element={<TodayPreviewPage showNotice={showNotice} />} />
          <Route path="/calc" element={<RoiPreviewPage />} />
          <Route path="/insights" element={<InsightsPreviewPage showNotice={showNotice} />} />
          <Route path="/enterprise" element={<EnterprisePreviewPage showNotice={showNotice} />} />
          <Route path="/account" element={<LockedFeaturePage title="Account" description="Profile, ownership, and personal workspace settings." showNotice={showNotice} />} />
          <Route path="/settings" element={<LockedFeaturePage title="Settings" description="AI, install, and runtime preferences." showNotice={showNotice} />} />
          <Route path="/apps" element={<AppsPreviewPage showNotice={showNotice} />} />
          <Route path="/admin" element={<LockedFeaturePage title="Admin" description="Admin-only controls and oversight." showNotice={showNotice} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <LockedModal notice={notice} onClose={() => setNotice(null)} />
      {showBottomNav ? <DemoBottomNav /> : null}
    </div>
  );
}
