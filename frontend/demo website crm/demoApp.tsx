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
      phone: "9876543211",
      email: "shlok@example.com",
      role: "buyer",
      tags: "premium,budget-ready",
      notes: "Interested in 3 BHK inventory in Pune west.",
      created_at: createdAt,
      updated_at: createdAt
    },
    {
      id: demoId("contact"),
      name: "Kunj Capital",
      occupation: "Investor",
      phone: "9876543212",
      email: "kunj@example.com",
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
      phone: "9876543213",
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
          <Route path="/today" element={<LockedFeaturePage title="Today" description="Daily priorities, reminders, and AI execution." showNotice={showNotice} />} />
          <Route path="/calc" element={<LockedFeaturePage title="ROI" description="Return, yield, and comparison tooling." showNotice={showNotice} />} />
          <Route path="/insights" element={<LockedFeaturePage title="Insights" description="Performance reporting and market intelligence." showNotice={showNotice} />} />
          <Route path="/enterprise" element={<LockedFeaturePage title="Enterprise" description="Org controls, builder workflows, and governance." showNotice={showNotice} />} />
          <Route path="/account" element={<LockedFeaturePage title="Account" description="Profile, ownership, and personal workspace settings." showNotice={showNotice} />} />
          <Route path="/settings" element={<LockedFeaturePage title="Settings" description="AI, install, and runtime preferences." showNotice={showNotice} />} />
          <Route path="/apps" element={<LockedFeaturePage title="Apps" description="Google Workspace, Zoom, ads, and other integrations." showNotice={showNotice} />} />
          <Route path="/admin" element={<LockedFeaturePage title="Admin" description="Admin-only controls and oversight." showNotice={showNotice} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <LockedModal notice={notice} onClose={() => setNotice(null)} />
      {showBottomNav ? <DemoBottomNav /> : null}
    </div>
  );
}
