import { useEffect, useMemo, useRef, useState } from "react";

import {
  API_BASE_URL,
  api,
  listDealImages,
  listWhatsAppInbox,
  sendWhatsAppMedia,
  type WhatsAppConversationSummaryRead,
} from "../api/client";
import Modal from "../components/Modal";
import type { Activity, Contact, ContactCreate, Deal, DealImage } from "../api/types";

async function pullDealContent(selected: Deal[]): Promise<string> {
  const blocks = await Promise.all(
    selected.map(async (deal, index) => {
      let images: DealImage[] = [];
      try {
        images = await listDealImages(deal.id);
      } catch {
        images = [];
      }
      const location = [deal.area, deal.city].filter(Boolean).join(", ");
      const budget = deal.ticket_size ?? deal.customer_budget;
      const prefix = selected.length > 1 ? `${index + 1}. ` : "";
      const lines = [`${prefix}${deal.title}${location ? ` — ${location}` : ""}`];
      if (budget != null) lines.push(`   Budget: Rs ${budget.toLocaleString("en-IN")}`);
      if (images.length) lines.push(`   Photos: ${images.map((img) => `${API_BASE_URL}${img.image_url}`).join(" ")}`);
      return lines.join("\n");
    }),
  );
  return ["Sharing the property details we discussed:", "", blocks.join("\n\n")].join("\n");
}

function normalizeWhatsAppNumber(value: string | null | undefined) {
  const digits = (value || "").replace(/\D+/g, "");
  if (digits.length < 10) return "";
  return digits;
}

function openWhatsApp(message: string, phone: string | null | undefined) {
  const target = normalizeWhatsAppNumber(phone);
  if (!target) {
    throw new Error("This contact needs a valid phone or WhatsApp number before sending.");
  }
  const url = `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatOptionalTimestamp(value: string | null) {
  return value ? formatTimestamp(value) : "No activity yet";
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function WhatsAppPage() {
  const [conversations, setConversations] = useState<WhatsAppConversationSummaryRead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [sending, setSending] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDealIds, setSelectedDealIds] = useState<string[]>([]);
  const [followupDraft, setFollowupDraft] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string>("");
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  async function loadInbox(preferredContactId?: string | null) {
    setLoadingInbox(true);
    try {
      const [rows, contactRows, dealRows] = await Promise.all([
        listWhatsAppInbox(),
        api<Contact[]>("/contacts"),
        api<Deal[]>("/deals"),
      ]);
      setConversations(rows);
      setContacts(contactRows);
      setDeals(dealRows);
      setSelectedContactId((current) => {
        const fallbackId = rows[0]?.contact_id ?? contactRows[0]?.id ?? null;
        const target = preferredContactId ?? current ?? fallbackId;
        const inRows = rows.some((row) => row.contact_id === target);
        const inContacts = contactRows.some((row) => row.id === target);
        return inRows || inContacts ? target : fallbackId;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load WhatsApp inbox");
    } finally {
      setLoadingInbox(false);
    }
  }

  useEffect(() => {
    void loadInbox();
    const timer = window.setInterval(() => {
      void loadInbox(selectedContactId);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [selectedContactId]);

  useEffect(() => {
    setFollowupDraft("");
    setSelectedDealIds([]);
    setAttachmentFile(null);
    setAttachmentPreviewUrl("");
    setAttachmentError(null);
    setSuccessMessage(null);
  }, [selectedContactId]);

  useEffect(() => {
    if (!attachmentFile || !attachmentFile.type.startsWith("image/")) {
      setAttachmentPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(attachmentFile);
    setAttachmentPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachmentFile]);

  const mergedContacts = useMemo(() => {
    const byId = new Map<string, WhatsAppConversationSummaryRead>();
    for (const conversation of conversations) {
      byId.set(conversation.contact_id, conversation);
    }

    const rows: WhatsAppConversationSummaryRead[] = contacts.map((contact) => {
      const existing = byId.get(contact.id);
      if (existing) return existing;
      return {
        contact_id: contact.id,
        contact_name: contact.name,
        contact_phone: contact.phone,
        contact_email: contact.email,
        latest_message: "No messages yet",
        latest_direction: "outbound",
        latest_status: "sent",
        latest_timestamp: null,
        message_count: 0,
      };
    });

    for (const conversation of conversations) {
      if (!rows.some((row) => row.contact_id === conversation.contact_id)) {
        rows.push(conversation);
      }
    }

    const term = search.trim().toLowerCase();
    const filtered = term
      ? rows.filter((row) =>
          [row.contact_name, row.contact_phone ?? "", row.contact_email ?? "", row.latest_message]
            .join(" ")
            .toLowerCase()
            .includes(term),
        )
      : rows;

    return filtered.sort((left, right) => {
      const leftTs = left.latest_timestamp ? new Date(left.latest_timestamp).getTime() : 0;
      const rightTs = right.latest_timestamp ? new Date(right.latest_timestamp).getTime() : 0;
      if (leftTs !== rightTs) return rightTs - leftTs;
      return left.contact_name.localeCompare(right.contact_name);
    });
  }, [contacts, conversations, search]);

  const selectedSummary = useMemo(
    () => mergedContacts.find((conversation) => conversation.contact_id === selectedContactId) ?? null,
    [mergedContacts, selectedContactId],
  );

  const dealOptions = useMemo(
    () =>
      deals
        .filter((deal) => deal.contact_id === selectedContactId)
        .slice()
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [deals, selectedContactId],
  );

  const selectedDeals = useMemo(
    () => dealOptions.filter((deal) => selectedDealIds.includes(deal.id)),
    [dealOptions, selectedDealIds],
  );

  const canSendWhatsApp = Boolean(normalizeWhatsAppNumber(selectedSummary?.contact_phone));

  function toggleDealSelection(dealId: string) {
    setSelectedDealIds((prev) => (prev.includes(dealId) ? prev.filter((id) => id !== dealId) : [...prev, dealId]));
  }

  useEffect(() => {
    if (selectedDealIds.length === 0) {
      setFollowupDraft("");
      return;
    }
    let cancelled = false;
    setPulling(true);
    pullDealContent(selectedDeals)
      .then((message) => {
        if (!cancelled) setFollowupDraft(message);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not pull deal content");
      })
      .finally(() => {
        if (!cancelled) setPulling(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealIds]);

  async function addActivity(payload: { summary: string; kind?: string; due_at?: string | null }) {
    if (!selectedContactId) return;
    setActivityBusy(true);
    setError(null);
    try {
      await api<Activity>("/activities", {
        method: "POST",
        body: JSON.stringify({
          contact_id: selectedContactId,
          deal_id: selectedDeals[0]?.id ?? null,
          kind: payload.kind ?? "whatsapp",
          summary: payload.summary,
          due_at: payload.due_at ?? null,
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add activity");
    } finally {
      setActivityBusy(false);
    }
  }

  async function addReminderInDays(days: number) {
    if (!selectedContactId) return;
    const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    setReminderBusy(true);
    setError(null);
    try {
      await api<Activity>("/activities", {
        method: "POST",
        body: JSON.stringify({
          contact_id: selectedContactId,
          deal_id: selectedDeals[0]?.id ?? null,
          kind: "call",
          summary: "Follow-up reminder",
          due_at: due.toISOString(),
        }),
      });
      setSuccessMessage("Reminder added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create reminder");
    } finally {
      setReminderBusy(false);
    }
  }

  async function sendFollowup() {
    if (!selectedContactId || !followupDraft.trim()) return;
    setError(null);
    setAttachmentError(null);
    setSuccessMessage(null);

    if (!attachmentFile) {
      try {
        openWhatsApp(followupDraft.trim(), selectedSummary?.contact_phone);
        await addActivity({ kind: "whatsapp", summary: followupDraft.trim() });
        setFollowupDraft("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "WhatsApp send failed");
      }
      return;
    }

    setSending(true);
    try {
      await sendWhatsAppMedia(selectedContactId, followupDraft.trim(), attachmentFile);
      await addActivity({ kind: "whatsapp", summary: `WhatsApp follow-up sent: ${attachmentFile.name}` });
      setFollowupDraft("");
      setAttachmentFile(null);
      setAttachmentPreviewUrl("");
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      setSuccessMessage("Sent");
      await loadInbox(selectedContactId);
    } catch (e) {
      setAttachmentError(e instanceof Error ? e.message : "WhatsApp media send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page whatsappPage">
      <div className="pageHeader">
        <div>
          <div className="h1">WhatsApp</div>
          <div className="muted">Pull deal details and photos into a follow-up, then send straight to WhatsApp.</div>
        </div>
        <button className="btn ghost" type="button" onClick={() => void loadInbox(selectedContactId)}>
          Refresh
        </button>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="whatsappLayout">
        <aside className="whatsappSidebar">
          <div className="sectionTitle">Conversations</div>
          <div className="row" style={{ marginTop: 12, marginBottom: 12 }}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contacts" />
            <button className="btn ghost" type="button" onClick={() => setCreateOpen(true)}>
              + Add contact
            </button>
          </div>
          {loadingInbox ? <div className="muted">Loading conversations...</div> : null}
          {!loadingInbox && mergedContacts.length === 0 ? <div className="muted">No contacts available yet.</div> : null}
          <div className="whatsappConversationList">
            {mergedContacts.map((conversation) => (
              <button
                key={conversation.contact_id}
                type="button"
                className={`whatsappConversationCard ${conversation.contact_id === selectedContactId ? "active" : ""}`}
                onClick={() => setSelectedContactId(conversation.contact_id)}
              >
                <div className="whatsappConversationTop">
                  <strong>{conversation.contact_name}</strong>
                  <span className="muted whatsappTiny">{formatOptionalTimestamp(conversation.latest_timestamp)}</span>
                </div>
                <div className="muted whatsappTiny">{conversation.contact_phone || conversation.contact_email || "No contact info"}</div>
                <div className="whatsappPreviewLine">{conversation.latest_message}</div>
                <div className="whatsappConversationMeta">
                  <span className="whatsappDirectionBadge">{conversation.latest_direction === "inbound" ? "Inbound" : "Outbound"}</span>
                  <span className="muted whatsappTiny">{conversation.message_count} messages</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="whatsappThreadPanel">
          {!selectedSummary ? (
            <div className="emptyStateCard">
              <div className="h2">No conversation selected</div>
              <div className="muted">Pick a contact from the inbox to draft a follow-up.</div>
            </div>
          ) : (
            <>
              <div className="whatsappThreadHeader">
                <div>
                  <div className="h2">{selectedSummary.contact_name}</div>
                  <div className="muted">
                    {selectedSummary.contact_phone || "No phone"}
                    {selectedSummary.contact_email ? ` · ${selectedSummary.contact_email}` : ""}
                  </div>
                </div>
                <div className="muted whatsappTiny">
                  {dealOptions.length} deal{dealOptions.length === 1 ? "" : "s"} linked
                </div>
              </div>

              <input
                ref={attachmentInputRef}
                type="file"
                hidden
                accept="image/*,video/mp4,application/pdf,audio/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (!file) return;
                  if (file.size > 16 * 1024 * 1024) {
                    setAttachmentError("File too large (max 16MB)");
                    e.target.value = "";
                    return;
                  }
                  setAttachmentError(null);
                  setAttachmentFile(file);
                }}
              />

              <div className="card" style={{ marginTop: 14 }}>
                <div className="cardTitle">AI Follow-up</div>
                <div className="muted">Pick deals to pull in their details and photos, send it to WhatsApp, or log it back into activity history.</div>

                <label style={{ marginTop: 10, display: "block" }}>
                  Deals for {selectedSummary.contact_name}
                  {dealOptions.length === 0 ? (
                    <div className="muted small" style={{ marginTop: 6 }}>No deals linked to this contact yet.</div>
                  ) : (
                    <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                      {dealOptions.map((deal) => (
                        <label key={deal.id} className="row" style={{ gap: 8, alignItems: "center", fontWeight: 400 }}>
                          <input type="checkbox" checked={selectedDealIds.includes(deal.id)} onChange={() => toggleDealSelection(deal.id)} />
                          <span>
                            {deal.title} — {deal.stage}
                            {deal.area ? `, ${deal.area}` : ""}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </label>
                {pulling ? <div className="muted small" style={{ marginTop: 6 }}>Pulling deal content...</div> : null}

                <textarea
                  className="textarea"
                  style={{ marginTop: 10 }}
                  value={followupDraft}
                  onChange={(e) => setFollowupDraft(e.target.value)}
                  placeholder="Select a deal above, or type a message to begin."
                />

                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <button className="btn ghost" onClick={() => attachmentInputRef.current?.click()} type="button">
                    Attach file
                  </button>
                  {attachmentFile ? <div className="muted small">Attachment ready</div> : null}
                </div>

                {attachmentFile ? (
                  <div className="attachmentPreview">
                    {attachmentPreviewUrl ? (
                      <img src={attachmentPreviewUrl} alt={attachmentFile.name} className="attachmentThumb" />
                    ) : (
                      <div className="attachmentFileIcon">FILE</div>
                    )}
                    <div className="attachmentMeta">
                      <div>{attachmentFile.name}</div>
                      <div className="muted small">{formatFileSize(attachmentFile.size)}</div>
                    </div>
                    <button
                      className="btn ghost compact"
                      onClick={() => {
                        setAttachmentFile(null);
                        setAttachmentPreviewUrl("");
                        setAttachmentError(null);
                        if (attachmentInputRef.current) attachmentInputRef.current.value = "";
                      }}
                      type="button"
                    >
                      X
                    </button>
                  </div>
                ) : null}
                {attachmentError ? <div className="muted small">{attachmentError}</div> : null}

                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    className="btn"
                    type="button"
                    disabled={sending || !followupDraft.trim() || (!attachmentFile && !canSendWhatsApp)}
                    onClick={() => void sendFollowup()}
                  >
                    {sending ? "Sending..." : "Send on WhatsApp"}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={activityBusy || !followupDraft.trim()}
                    onClick={() => void addActivity({ kind: "whatsapp", summary: followupDraft || "Follow-up sent" })}
                  >
                    {activityBusy ? "Logging..." : "Log activity"}
                  </button>
                  <button className="btn ghost" type="button" disabled={reminderBusy} onClick={() => void addReminderInDays(2)}>
                    {reminderBusy ? "Adding reminder..." : "Remind in 2 days"}
                  </button>
                </div>

                {successMessage ? <div className="muted small">{successMessage}</div> : null}
                {!canSendWhatsApp ? (
                  <div className="muted whatsappTiny">Add a valid phone number to this contact before sending outbound WhatsApp messages.</div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>

      <Modal title="Add contact to WhatsApp" open={createOpen} onClose={() => setCreateOpen(false)}>
        <CreateWhatsAppContactForm
          onCreate={async (payload) => {
            const created = await api<Contact>("/contacts", { method: "POST", body: JSON.stringify(payload) });
            setCreateOpen(false);
            setSearch("");
            await loadInbox(created.id);
          }}
        />
      </Modal>
    </div>
  );
}

function CreateWhatsAppContactForm({ onCreate }: { onCreate: (payload: ContactCreate) => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("buyer");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = name.trim().length >= 2 && !busy;

  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canSubmit) return;
        setBusy(true);
        try {
          await onCreate({
            name: name.trim(),
            phone: phone.trim() || null,
            email: email.trim() || null,
            role,
            notes: notes.trim(),
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Client or investor name" />
      </label>
      <div className="grid2">
        <label>
          Phone
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98XXXXXXXX" />
        </label>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
        </label>
      </div>
      <label>
        Purpose
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="buyer">Buyer</option>
          <option value="seller">Seller</option>
          <option value="investor">Investor</option>
          <option value="tenant">Tenant</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Notes
        <textarea
          className="textarea"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Context for the first conversation"
        />
      </label>
      <div className="row right">
        <button className="btn" type="submit" disabled={!canSubmit}>
          {busy ? "Creating..." : "Create contact"}
        </button>
      </div>
    </form>
  );
}
