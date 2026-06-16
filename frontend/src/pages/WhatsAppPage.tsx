import { useEffect, useMemo, useState } from "react";

import {
  api,
  getWhatsAppConversation,
  listWhatsAppInbox,
  sendWhatsAppMessage,
  type WhatsAppConversationRead,
  type WhatsAppConversationSummaryRead,
} from "../api/client";
import Modal from "../components/Modal";
import type { Contact, ContactCreate } from "../api/types";

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

export default function WhatsAppPage() {
  const [conversations, setConversations] = useState<WhatsAppConversationSummaryRead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [thread, setThread] = useState<WhatsAppConversationRead | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadInbox(preferredContactId?: string | null) {
    setLoadingInbox(true);
    try {
      const [rows, contactRows] = await Promise.all([listWhatsAppInbox(), api<Contact[]>("/contacts")]);
      setConversations(rows);
      setContacts(contactRows);
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

  async function loadThread(contactId: string) {
    setLoadingThread(true);
    try {
      const response = await getWhatsAppConversation(contactId);
      setThread(response);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversation");
      setThread(null);
    } finally {
      setLoadingThread(false);
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
    if (!selectedContactId) {
      setThread(null);
      return;
    }
    void loadThread(selectedContactId);
    const timer = window.setInterval(() => {
      void loadThread(selectedContactId);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [selectedContactId]);

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

  async function handleSend() {
    if (!selectedContactId || !draft.trim()) return;
    setSending(true);
    try {
      await sendWhatsAppMessage(selectedContactId, draft.trim());
      setDraft("");
      await Promise.all([loadInbox(selectedContactId), loadThread(selectedContactId)]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page whatsappPage">
      <div className="pageHeader">
        <div>
          <div className="h1">WhatsApp</div>
          <div className="muted">Follow up with leads and clients from one inbox.</div>
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
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search contacts"
            />
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
              <div className="muted">Pick a contact from the inbox to view and send messages.</div>
            </div>
          ) : (
            <>
              <div className="whatsappThreadHeader">
                <div>
                  <div className="h2">{thread?.contact_name || selectedSummary.contact_name}</div>
                  <div className="muted">
                    {(thread?.contact_phone ?? selectedSummary.contact_phone) || "No phone"}{" "}
                    {(thread?.contact_email ?? selectedSummary.contact_email)
                      ? `· ${thread?.contact_email ?? selectedSummary.contact_email}`
                      : ""}
                  </div>
                </div>
                <div className="muted whatsappTiny">Latest update {formatOptionalTimestamp(selectedSummary.latest_timestamp)}</div>
              </div>

              <div className="whatsappMessages">
                {loadingThread ? <div className="muted">Loading messages...</div> : null}
                {!loadingThread && thread && thread.messages.length === 0 ? (
                  <div className="muted">No messages yet. Start the conversation below.</div>
                ) : null}
                {!loadingThread &&
                  thread?.messages.map((message) => (
                    <div
                      key={message.id}
                      className={`whatsappBubble ${message.direction === "outbound" ? "outbound" : "inbound"}`}
                    >
                      <div>{message.message_body}</div>
                      <div className="whatsappBubbleMeta">
                        <span>{formatTimestamp(message.timestamp)}</span>
                        {message.direction === "outbound" ? <span>{message.status}</span> : null}
                      </div>
                    </div>
                  ))}
              </div>

              <div className="whatsappComposer">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Type a WhatsApp message..."
                  rows={3}
                />
                <div className="whatsappComposerActions">
                  <button className="btn" type="button" disabled={sending || !draft.trim()} onClick={() => void handleSend()}>
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
                {!selectedSummary.contact_phone ? (
                  <div className="muted whatsappTiny">Add a phone number to this contact before sending outbound WhatsApp messages.</div>
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
        <textarea className="textarea" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Context for the first conversation" />
      </label>
      <div className="row right">
        <button className="btn" type="submit" disabled={!canSubmit}>
          {busy ? "Creating..." : "Create contact"}
        </button>
      </div>
    </form>
  );
}
