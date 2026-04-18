import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import type { Activity, Contact, Deal } from "../api/types";

type DealScoreResponse = { deal_id: string; close_probability: number; risk_flags: string[]; rationale: string[] };
type FollowupResponse = { deal_id: string; message: string };
type LlmFollowupResponse = { deal_id: string; message: string };

function normalizeWhatsAppNumber(value: string | null | undefined) {
  const digits = (value || "").replace(/\D+/g, "");
  if (digits.length < 10) return "";
  return digits;
}

function openWhatsApp(message: string, phone: string | null | undefined) {
  const target = normalizeWhatsAppNumber(phone);
  if (!target) {
    throw new Error("Linked contact needs a valid phone or WhatsApp number before sending.");
  }
  const url = `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

function formatMoney(value: number | null | undefined) {
  if (value == null) return "-";
  return `Rs ${value.toLocaleString()}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

export default function DealDetailPage() {
  const { dealId } = useParams();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [followupDraft, setFollowupDraft] = useState("");
  const [score, setScore] = useState<DealScoreResponse | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [whatsAppContactId, setWhatsAppContactId] = useState("");
  const [editing, setEditing] = useState(false);
  const [editPayload, setEditPayload] = useState({
    contact_id: "",
    visit_date: "",
    typology: "",
    customer_budget: "",
    client_phase: "",
    close_probability: "",
    expected_yield_pct: "",
    expected_roi_pct: "",
    liquidity_days_est: "",
    risk_flags: ""
  });

  async function load() {
    if (!dealId) return;
    setError(null);
    try {
      const d = await api<Deal>(`/deals/${dealId}`);
      setDeal(d);
      setNoteDraft(d.notes ?? "");
      setEditPayload({
        contact_id: d.contact_id ?? "",
        visit_date: d.visit_date ?? "",
        typology: d.typology ?? "",
        customer_budget: d.customer_budget == null ? "" : String(d.customer_budget),
        client_phase: d.client_phase ?? "",
        close_probability: d.close_probability == null ? "" : String(d.close_probability),
        expected_yield_pct: d.expected_yield_pct == null ? "" : String(d.expected_yield_pct),
        expected_roi_pct: d.expected_roi_pct == null ? "" : String(d.expected_roi_pct),
        liquidity_days_est: d.liquidity_days_est == null ? "" : String(d.liquidity_days_est),
        risk_flags: d.risk_flags ?? ""
      });
      const contactRows = await api<Contact[]>("/contacts");
      setContacts(contactRows);
      const preferredContactId =
        (d.contact_id && contactRows.some((contact) => contact.id === d.contact_id) ? d.contact_id : "") ||
        contactRows.find((contact) => normalizeWhatsAppNumber(contact.phone))?.id ||
        "";
      setWhatsAppContactId(preferredContactId);
      const a = await api<Activity[]>(`/activities?deal_id=${encodeURIComponent(dealId)}`);
      setActivities(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deal");
    }
  }

  useEffect(() => {
    void load();
  }, [dealId]);

  async function saveNotes() {
    if (!dealId) return;
    const updated = await api<Deal>(`/deals/${dealId}`, { method: "PATCH", body: JSON.stringify({ notes: noteDraft }) });
    setDeal(updated);
  }

  async function addActivity(payload: { summary: string; kind?: string; due_at?: string | null }) {
    if (!dealId) return;
    const created = await api<Activity>("/activities", {
      method: "POST",
      body: JSON.stringify({
        deal_id: dealId,
        kind: payload.kind ?? "whatsapp",
        summary: payload.summary,
        due_at: payload.due_at ?? null
      })
    });
    setActivities((prev) => [created, ...prev]);
    await load();
  }

  async function addReminderInDays(days: number) {
    if (!dealId) return;
    const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await api<Activity>("/activities", {
      method: "POST",
      body: JSON.stringify({
        deal_id: dealId,
        kind: "call",
        summary: "Follow-up reminder",
        due_at: due.toISOString()
      })
    });
    await load();
  }

  async function toggleActivityDone(a: Activity) {
    const updated = await api<Activity>(`/activities/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ completed: !a.completed })
    });
    setActivities((prev) => prev.map((x) => (x.id === a.id ? updated : x)));
  }

  async function deleteActivity(a: Activity) {
    await api<{ deleted: boolean }>(`/activities/${a.id}`, { method: "DELETE" });
    setActivities((prev) => prev.filter((x) => x.id !== a.id));
  }

  async function saveDealSnapshot() {
    if (!dealId) return;
    const payload: Record<string, unknown> = {
      contact_id: editPayload.contact_id || null,
      visit_date: editPayload.visit_date || null,
      typology: editPayload.typology.trim(),
      client_phase: editPayload.client_phase || "",
      risk_flags: editPayload.risk_flags
    };
    payload.customer_budget = editPayload.customer_budget === "" ? null : Number(editPayload.customer_budget);
    payload.close_probability = editPayload.close_probability === "" ? null : Number(editPayload.close_probability);
    payload.expected_yield_pct = editPayload.expected_yield_pct === "" ? null : Number(editPayload.expected_yield_pct);
    payload.expected_roi_pct = editPayload.expected_roi_pct === "" ? null : Number(editPayload.expected_roi_pct);
    payload.liquidity_days_est = editPayload.liquidity_days_est === "" ? null : Number(editPayload.liquidity_days_est);

    const updated = await api<Deal>(`/deals/${dealId}`, { method: "PATCH", body: JSON.stringify(payload) });
    setDeal(updated);
    setEditing(false);
  }

  if (!dealId) return <div className="page">Missing deal ID.</div>;
  const whatsAppContact = contacts.find((contact) => contact.id === whatsAppContactId) || null;
  const whatsAppPhone = whatsAppContact?.phone;
  const canSendWhatsApp = Boolean(normalizeWhatsAppNumber(whatsAppPhone));

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">{deal?.title ?? "Deal"}</div>
          <div className="muted">
            {deal ? `${deal.asset_type} | ${deal.stage} | ${deal.area}${deal.city ? `, ${deal.city}` : ""}` : "Loading deal..."}
          </div>
        </div>
        <button className="btn ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error ? <div className="alert">{error}</div> : null}

      {deal ? (
        <div className="detailGrid">
          <section className="card premiumPanel">
            <div className="cardTitle">Deal Snapshot</div>
            <div className="kv">
              <div className="k">Ticket Size</div>
              <div className="v">{formatMoney(deal.ticket_size)}</div>
              <div className="k">Customer Budget</div>
              <div className="v">{formatMoney(deal.customer_budget)}</div>
              <div className="k">Date of Visit</div>
              <div className="v">{formatDate(deal.visit_date)}</div>
              <div className="k">Typology</div>
              <div className="v">{deal.typology || "-"}</div>
              <div className="k">Client Phase</div>
              <div className="v">{deal.client_phase || "-"}</div>
              <div className="k">Close Probability</div>
              <div className="v">{deal.close_probability ?? "-"}%</div>
              <div className="k">Yield</div>
              <div className="v">{deal.expected_yield_pct ?? "-"}%</div>
              <div className="k">ROI</div>
              <div className="v">{deal.expected_roi_pct ?? "-"}%</div>
              <div className="k">Liquidity (days)</div>
              <div className="v">{deal.liquidity_days_est ?? "-"}</div>
              <div className="k">Risk Flags</div>
              <div className="v">{deal.risk_flags || "-"}</div>
            </div>
            <div className="row right">
              <button className="btn ghost" onClick={() => setEditing((v) => !v)} type="button">
                {editing ? "Close editor" : "Edit snapshot"}
              </button>
            </div>
          </section>

          {editing ? (
            <section className="card">
              <div className="cardTitle">Edit Snapshot</div>
              <div className="form">
                <label>
                  Related Contact
                  <select
                    value={editPayload.contact_id}
                    onChange={(e) => setEditPayload((p) => ({ ...p, contact_id: e.target.value }))}
                  >
                    <option value="">None selected</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.role})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid2">
                  <label>
                    Date of Visit
                    <input
                      type="date"
                      value={editPayload.visit_date}
                      onChange={(e) => setEditPayload((p) => ({ ...p, visit_date: e.target.value }))}
                    />
                  </label>
                  <label>
                    Typology
                    <input
                      value={editPayload.typology}
                      onChange={(e) => setEditPayload((p) => ({ ...p, typology: e.target.value }))}
                      placeholder="2 BHK, 4 BHK, penthouse, 3 acres land"
                    />
                  </label>
                </div>
                <div className="grid2">
                  <label>
                    Customer Budget (Rs)
                    <input
                      inputMode="numeric"
                      value={editPayload.customer_budget}
                      onChange={(e) => setEditPayload((p) => ({ ...p, customer_budget: e.target.value }))}
                      placeholder="8500000"
                    />
                  </label>
                  <label>
                    Client phase
                    <select value={editPayload.client_phase} onChange={(e) => setEditPayload((p) => ({ ...p, client_phase: e.target.value }))}>
                      <option value="">Select phase</option>
                      <option value="hot">Hot - payment can happen soon</option>
                      <option value="warm">Warm - interested and engaged</option>
                      <option value="cold">Cold - visited but less interested</option>
                      <option value="lost">Lost - no longer active</option>
                    </select>
                  </label>
                </div>
                <div className="grid2">
                  <label>
                    Close Probability (%)
                    <input
                      inputMode="numeric"
                      value={editPayload.close_probability}
                      onChange={(e) => setEditPayload((p) => ({ ...p, close_probability: e.target.value }))}
                      placeholder="72"
                    />
                  </label>
                  <label>
                    Liquidity (days)
                    <input
                      inputMode="numeric"
                      value={editPayload.liquidity_days_est}
                      onChange={(e) => setEditPayload((p) => ({ ...p, liquidity_days_est: e.target.value }))}
                      placeholder="30"
                    />
                  </label>
                </div>
                <div className="grid2">
                  <label>
                    Yield (%)
                    <input
                      inputMode="decimal"
                      value={editPayload.expected_yield_pct}
                      onChange={(e) => setEditPayload((p) => ({ ...p, expected_yield_pct: e.target.value }))}
                      placeholder="8.5"
                    />
                  </label>
                  <label>
                    ROI (%)
                    <input
                      inputMode="decimal"
                      value={editPayload.expected_roi_pct}
                      onChange={(e) => setEditPayload((p) => ({ ...p, expected_roi_pct: e.target.value }))}
                      placeholder="18"
                    />
                  </label>
                </div>
                <label>
                  Risk Flags (comma separated)
                  <input
                    value={editPayload.risk_flags}
                    onChange={(e) => setEditPayload((p) => ({ ...p, risk_flags: e.target.value }))}
                    placeholder="pricing, legal, builder, inventory"
                  />
                </label>
                <div className="row right">
                  <button className="btn" onClick={() => void saveDealSnapshot()} type="button">
                    Save snapshot
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <section className="card">
            <div className="cardTitle">Notes</div>
            <textarea className="textarea" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
            <div className="row right">
              <button className="btn" onClick={() => void saveNotes()}>
                Save notes
              </button>
            </div>
          </section>

          <section className="card">
            <div className="cardTitle">AI Follow-up</div>
            <div className="muted">Generate a client-ready follow-up, send it to WhatsApp, or log it back into activity history.</div>
            <label>
              Send WhatsApp to
              <select value={whatsAppContactId} onChange={(e) => setWhatsAppContactId(e.target.value)}>
                <option value="">Choose contact</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} ({contact.role}){normalizeWhatsAppNumber(contact.phone) ? "" : " - no valid phone"}
                  </option>
                ))}
              </select>
            </label>
            <textarea className="textarea" value={followupDraft} onChange={(e) => setFollowupDraft(e.target.value)} placeholder="Generate a follow-up message to begin." />
            <div className="row">
              <button
                className="btn"
                onClick={async () => {
                  try {
                    const resp = await api<LlmFollowupResponse>("/ai/llm/followup", {
                      method: "POST",
                      body: JSON.stringify({
                        provider: "openrouter",
                        deal_id: deal.id,
                        objective: "followup",
                        channel: "whatsapp",
                        tone: "professional"
                      })
                    });
                    setFollowupDraft(resp.message);
                  } catch (e) {
                    if (!(e instanceof ApiError) || (e.status !== 400 && e.status !== 404)) throw e;
                    const resp = await api<FollowupResponse>("/ai/followup", {
                      method: "POST",
                      body: JSON.stringify({ deal_id: deal.id, objective: "followup", channel: "whatsapp", tone: "professional" })
                    });
                    setFollowupDraft(resp.message);
                  }
                }}
                type="button"
              >
                Generate
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={!followupDraft.trim() || !canSendWhatsApp}
                onClick={() => {
                  try {
                    openWhatsApp(followupDraft.trim(), whatsAppPhone);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "WhatsApp send failed");
                  }
                }}
              >
                Send on WhatsApp
              </button>
              <button
                className="btn ghost"
                onClick={() => void addActivity({ kind: "whatsapp", summary: followupDraft || "Follow-up sent" })}
                type="button"
              >
                Log activity
              </button>
              <button className="btn ghost" onClick={() => void addReminderInDays(2)} type="button">
                Remind in 2 days
              </button>
            </div>
            {!canSendWhatsApp ? (
              <div className="muted small">Choose a contact with a valid phone or WhatsApp number before sending.</div>
            ) : null}
          </section>

          <section className="card">
            <div className="cardTitle">Deal Score</div>
            <div className="row">
              <button
                className="btn"
                onClick={async () => {
                  const resp = await api<DealScoreResponse>(`/ai/deal-score/${deal.id}`, { method: "POST" });
                  setScore(resp);
                  await load();
                }}
                type="button"
              >
                Run score
              </button>
              <div className="muted">This updates close probability directly on the deal record.</div>
            </div>
            {score ? (
              <div className="list">
                <div className="listItem">
                  <div className="muted">Close probability</div>
                  <div className="v">{score.close_probability}%</div>
                </div>
                <div className="listItem">
                  <div className="muted">Rationale</div>
                  <div>{score.rationale.join(" ")}</div>
                </div>
              </div>
            ) : (
              <div className="muted">No score has been generated yet.</div>
            )}
          </section>

          <section className="card">
            <div className="cardTitle">Activities</div>
            <ActivityComposer onAdd={addActivity} />
            <div className="list">
              {activities.map((a) => (
                <div key={a.id} className="listItem">
                  <div className="muted">
                    {a.kind} | {new Date(a.created_at).toLocaleString()}
                  </div>
                  <div className="row">
                    <div className="grow">{a.summary || "-"}</div>
                    <button className={a.completed ? "btn ghost" : "btn"} onClick={() => void toggleActivityDone(a)} type="button">
                      {a.completed ? "Completed" : "Mark done"}
                    </button>
                    <button className="btn ghost" onClick={() => void deleteActivity(a)} type="button">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {activities.length === 0 ? <div className="muted">No activities recorded yet.</div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ActivityComposer({
  onAdd
}: {
  onAdd: (payload: { summary: string; kind?: string; due_at?: string | null }) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("call");
  const [dueAt, setDueAt] = useState("");
  return (
    <form
      className="row"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        const summary = text.trim();
        setText("");
        await onAdd({
          summary,
          kind,
          due_at: dueAt ? new Date(dueAt).toISOString() : null
        });
        setDueAt("");
      }}
    >
      <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 140 }}>
        <option value="call">Call</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="meeting">Meeting</option>
        <option value="site_visit">Site visit</option>
        <option value="email">Email</option>
        <option value="other">Other</option>
      </select>
      <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an activity note..." />
      <input
        className="input"
        type="datetime-local"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        style={{ width: 210 }}
        title="Optional reminder time"
      />
      <button className="btn" type="submit">
        Add
      </button>
    </form>
  );
}
