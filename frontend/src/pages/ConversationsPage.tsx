import { useEffect, useRef, useState } from "react";

import { API_BASE_URL, ApiError, api, apiForm } from "../api/client";

type ChatContact = {
  user_id: string;
  name: string;
  email: string;
  role_label: string;
  last_message: string;
  last_message_at: string | null;
  unread_count: number;
};

type ChatMessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  attachment_url: string;
  attachment_filename: string;
  is_mine: boolean;
  read_at: string | null;
  created_at: string;
};

type TeamRow = {
  id: string;
  name: string;
  description: string;
  member_count: number;
  member_ids: string[];
  created_at: string;
};

function formatTimestamp(value: string | null) {
  if (!value) return "No activity yet";
  return new Date(value).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function roleLabel(role: string) {
  if (role === "owner") return "Owner";
  if (role === "broker") return "Broker";
  if (role === "cp") return "CP";
  return "Employee";
}

export default function ConversationsPage() {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const [isOwner, setIsOwner] = useState(false);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastTeamId, setBroadcastTeamId] = useState("");
  const [broadcastRecipients, setBroadcastRecipients] = useState<Set<string>>(new Set());
  const [broadcastDraft, setBroadcastDraft] = useState("");
  const [broadcastFile, setBroadcastFile] = useState<File | null>(null);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState<string | null>(null);
  const broadcastFileInputRef = useRef<HTMLInputElement | null>(null);

  async function loadContacts(preferredId?: string | null) {
    setLoadingContacts(true);
    try {
      const rows = await api<ChatContact[]>("/enterprise/chat/contacts");
      setContacts(rows);
      setNotAvailable(false);
      setSelectedContactId((current) => {
        const target = preferredId ?? current;
        if (target && rows.some((row) => row.user_id === target)) return target;
        return rows[0]?.user_id ?? null;
      });
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setNotAvailable(true);
        setContacts([]);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load contacts");
      }
    } finally {
      setLoadingContacts(false);
    }
  }

  async function loadThread(contactId: string) {
    setLoadingThread(true);
    try {
      const rows = await api<ChatMessageRow[]>(`/enterprise/chat/messages/${contactId}`);
      setMessages(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversation");
    } finally {
      setLoadingThread(false);
    }
  }

  useEffect(() => {
    void loadContacts();
    api<{ plan: string; enterprise_owner_id: string | null }>("/auth/me")
      .then((me) => {
        const plan = (me.plan || "").toLowerCase();
        setIsOwner((plan === "enterprise" || plan === "builder") && !me.enterprise_owner_id);
      })
      .catch(() => {});
    const timer = window.setInterval(() => {
      void loadContacts(selectedContactId);
    }, 20000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    api<TeamRow[]>("/enterprise/teams").then(setTeams).catch(() => {});
  }, [isOwner]);

  useEffect(() => {
    if (!selectedContactId) {
      setMessages([]);
      return;
    }
    void loadThread(selectedContactId);
    const timer = window.setInterval(() => {
      void loadThread(selectedContactId);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [selectedContactId]);

  const selectedContact = contacts.find((contact) => contact.user_id === selectedContactId) ?? null;

  async function handleSend() {
    if (!selectedContactId || (!draft.trim() && !attachmentFile)) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("recipient_id", selectedContactId);
      formData.append("body", draft.trim());
      if (attachmentFile) formData.append("file", attachmentFile);
      await apiForm("/enterprise/chat/messages", formData);
      setDraft("");
      setAttachmentFile(null);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      await Promise.all([loadThread(selectedContactId), loadContacts(selectedContactId)]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  function toggleBroadcastRecipient(userId: string) {
    setBroadcastRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleBroadcastSend() {
    if (broadcastRecipients.size === 0 || (!broadcastDraft.trim() && !broadcastFile)) return;
    setBroadcastSending(true);
    setBroadcastMsg(null);
    try {
      const formData = new FormData();
      formData.append("recipient_ids", JSON.stringify(Array.from(broadcastRecipients)));
      formData.append("body", broadcastDraft.trim());
      if (broadcastFile) formData.append("file", broadcastFile);
      await apiForm("/enterprise/chat/broadcast", formData);
      setBroadcastMsg(`Sent to ${broadcastRecipients.size} recipient${broadcastRecipients.size === 1 ? "" : "s"}.`);
      setBroadcastDraft("");
      setBroadcastFile(null);
      setBroadcastRecipients(new Set());
      setBroadcastTeamId("");
      if (broadcastFileInputRef.current) broadcastFileInputRef.current.value = "";
      await loadContacts(selectedContactId);
    } catch (e) {
      setBroadcastMsg(e instanceof Error ? e.message : "Failed to send broadcast");
    } finally {
      setBroadcastSending(false);
    }
  }

  if (notAvailable) {
    return (
      <div className="page">
        <div className="pageHeader">
          <div>
            <div className="h1">Conversations</div>
            <div className="muted">Internal team chat for enterprise and builder workspaces.</div>
          </div>
        </div>
        <div className="emptyStateCard">
          <div className="h2">Not available on your plan</div>
          <div className="muted">Internal chat is available for Enterprise and Builder accounts and their team members.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page whatsappPage">
      <div className="pageHeader">
        <div>
          <div className="h1">Conversations</div>
          <div className="muted">Chat with your team or manager, with file sharing.</div>
        </div>
        <div className="row">
          {isOwner ? (
            <button className="btn ghost" type="button" onClick={() => setBroadcastOpen((v) => !v)}>
              {broadcastOpen ? "Close broadcast" : "Message a team"}
            </button>
          ) : null}
          <button className="btn ghost" type="button" onClick={() => void loadContacts(selectedContactId)}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      {broadcastOpen ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="cardTitle">Message a team</div>
          <div className="muted">Pick a team to message everyone in it at once, or hand-pick recipients below.</div>

          <div className="grid2" style={{ marginTop: 12 }}>
            <label>
              Team (optional)
              <select
                value={broadcastTeamId}
                onChange={(e) => {
                  const teamId = e.target.value;
                  setBroadcastTeamId(teamId);
                  const team = teams.find((row) => row.id === teamId);
                  setBroadcastRecipients(new Set(team ? team.member_ids : []));
                }}
              >
                <option value="">Choose a team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="muted small" style={{ marginTop: 12 }}>Recipients ({broadcastRecipients.size} selected)</div>
          <div className="stack" style={{ gap: 6, marginTop: 6, maxHeight: 180, overflowY: "auto" }}>
            {contacts.map((contact) => (
              <label key={contact.user_id} className="row" style={{ gap: 8, alignItems: "center", fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={broadcastRecipients.has(contact.user_id)}
                  onChange={() => toggleBroadcastRecipient(contact.user_id)}
                />
                <span>{contact.name} ({roleLabel(contact.role_label)})</span>
              </label>
            ))}
          </div>

          <input
            ref={broadcastFileInputRef}
            type="file"
            hidden
            accept="image/*,video/mp4,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              if (!file) return;
              if (file.size > 16 * 1024 * 1024) {
                setBroadcastMsg("File too large (max 16MB)");
                e.target.value = "";
                return;
              }
              setBroadcastFile(file);
            }}
          />

          <textarea
            className="textarea"
            style={{ marginTop: 12 }}
            value={broadcastDraft}
            onChange={(e) => setBroadcastDraft(e.target.value)}
            placeholder="Write the message to send to everyone selected..."
          />

          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <button className="btn ghost" type="button" onClick={() => broadcastFileInputRef.current?.click()}>
              Attach file
            </button>
            {broadcastFile ? (
              <div className="muted small">
                {broadcastFile.name}{" "}
                <button
                  type="button"
                  className="btn ghost compact"
                  onClick={() => {
                    setBroadcastFile(null);
                    if (broadcastFileInputRef.current) broadcastFileInputRef.current.value = "";
                  }}
                >
                  X
                </button>
              </div>
            ) : null}
          </div>

          {broadcastMsg ? <div className="alert ok" style={{ marginTop: 8 }}>{broadcastMsg}</div> : null}
          <button
            className="btn"
            type="button"
            style={{ marginTop: 8 }}
            disabled={broadcastSending || broadcastRecipients.size === 0 || (!broadcastDraft.trim() && !broadcastFile)}
            onClick={() => void handleBroadcastSend()}
          >
            {broadcastSending ? "Sending..." : `Send to ${broadcastRecipients.size || ""} recipient${broadcastRecipients.size === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : null}

      <div className="whatsappLayout">
        <aside className="whatsappSidebar">
          <div className="sectionTitle">Team</div>
          {loadingContacts ? <div className="muted" style={{ marginTop: 12 }}>Loading...</div> : null}
          {!loadingContacts && contacts.length === 0 ? <div className="muted" style={{ marginTop: 12 }}>No teammates yet.</div> : null}
          <div className="whatsappConversationList" style={{ marginTop: 12 }}>
            {contacts.map((contact) => (
              <button
                key={contact.user_id}
                type="button"
                className={`whatsappConversationCard ${contact.user_id === selectedContactId ? "active" : ""}`}
                onClick={() => setSelectedContactId(contact.user_id)}
              >
                <div className="whatsappConversationTop">
                  <strong>{contact.name}</strong>
                  <span className="muted whatsappTiny">{formatTimestamp(contact.last_message_at)}</span>
                </div>
                <div className="muted whatsappTiny">{roleLabel(contact.role_label)}</div>
                <div className="whatsappPreviewLine">{contact.last_message || "No messages yet"}</div>
                {contact.unread_count > 0 ? (
                  <div className="whatsappConversationMeta">
                    <span className="whatsappDirectionBadge">{contact.unread_count} new</span>
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </aside>

        <section className="whatsappThreadPanel">
          {!selectedContact ? (
            <div className="emptyStateCard">
              <div className="h2">No conversation selected</div>
              <div className="muted">Pick a teammate to start chatting.</div>
            </div>
          ) : (
            <>
              <div className="whatsappThreadHeader">
                <div>
                  <div className="h2">{selectedContact.name}</div>
                  <div className="muted">
                    {roleLabel(selectedContact.role_label)} · {selectedContact.email}
                  </div>
                </div>
              </div>

              <input
                ref={attachmentInputRef}
                type="file"
                hidden
                accept="image/*,video/mp4,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (!file) return;
                  if (file.size > 16 * 1024 * 1024) {
                    setError("File too large (max 16MB)");
                    e.target.value = "";
                    return;
                  }
                  setError(null);
                  setAttachmentFile(file);
                }}
              />

              <div className="whatsappMessages">
                {loadingThread ? <div className="muted">Loading messages...</div> : null}
                {!loadingThread && messages.length === 0 ? (
                  <div className="muted">No messages yet. Start the conversation below.</div>
                ) : null}
                {!loadingThread &&
                  messages.map((message) => (
                    <div key={message.id} className={`whatsappBubble ${message.is_mine ? "outbound" : "inbound"}`}>
                      {message.body ? <div>{message.body}</div> : null}
                      {message.attachment_url ? (
                        <a
                          href={`${API_BASE_URL}${message.attachment_url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="chatAttachmentLink"
                        >
                          {message.attachment_filename || "Attachment"}
                        </a>
                      ) : null}
                      <div className="whatsappBubbleMeta">
                        <span>{formatTimestamp(message.created_at)}</span>
                      </div>
                    </div>
                  ))}
              </div>

              <div className="whatsappComposer">
                {attachmentFile ? (
                  <div className="muted small" style={{ marginBottom: 6 }}>
                    Attached: {attachmentFile.name}{" "}
                    <button
                      type="button"
                      className="btn ghost compact"
                      onClick={() => {
                        setAttachmentFile(null);
                        if (attachmentInputRef.current) attachmentInputRef.current.value = "";
                      }}
                    >
                      X
                    </button>
                  </div>
                ) : null}
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type a message..."
                  rows={3}
                />
                <div className="whatsappComposerActions">
                  <button className="btn ghost" type="button" onClick={() => attachmentInputRef.current?.click()}>
                    Attach file
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={sending || (!draft.trim() && !attachmentFile)}
                    onClick={() => void handleSend()}
                  >
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
