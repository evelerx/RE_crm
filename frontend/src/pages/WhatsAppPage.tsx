import { useEffect, useMemo, useState } from "react";

import {
  getWhatsAppConversation,
  listWhatsAppInbox,
  sendWhatsAppMessage,
  type WhatsAppConversationRead,
  type WhatsAppConversationSummaryRead,
} from "../api/client";

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
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [thread, setThread] = useState<WhatsAppConversationRead | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadInbox(preferredContactId?: string | null) {
    setLoadingInbox(true);
    try {
      const rows = await listWhatsAppInbox();
      setConversations(rows);
      setSelectedContactId((current) => {
        const target = preferredContactId ?? current ?? rows[0]?.contact_id ?? null;
        return rows.some((row) => row.contact_id === target) ? target : rows[0]?.contact_id ?? null;
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

  const selectedSummary = useMemo(
    () => conversations.find((conversation) => conversation.contact_id === selectedContactId) ?? null,
    [conversations, selectedContactId],
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
          {loadingInbox ? <div className="muted">Loading conversations...</div> : null}
          {!loadingInbox && conversations.length === 0 ? <div className="muted">No WhatsApp conversations yet.</div> : null}
          <div className="whatsappConversationList">
            {conversations.map((conversation) => (
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
                  <div className="h2">{selectedSummary.contact_name}</div>
                  <div className="muted">
                    {selectedSummary.contact_phone || "No phone"} {selectedSummary.contact_email ? `· ${selectedSummary.contact_email}` : ""}
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
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
