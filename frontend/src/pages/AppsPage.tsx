import type { ChangeEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../api/client";

type ProviderStatus = {
  key: string;
  name: string;
  provider_group: string;
  category: string;
  status: string;
  configured: boolean;
  connected: boolean;
  can_connect: boolean;
  managed_by_owner: boolean;
  connected_account_email: string;
  inheritance_mode: string;
  required_env: string[];
  next_step: string;
  last_error: string;
};

type IntegrationsResponse = {
  plan: string;
  enterprise_owner_id: string | null;
  is_enterprise_owner: boolean;
  is_enterprise_member: boolean;
  access_role: string;
  can_manage: boolean;
  can_view: boolean;
  owner_managed: boolean;
  providers: ProviderStatus[];
};

type ConnectResponse = {
  provider: string;
  auth_url: string;
};

type GoogleConnectionTestResponse = {
  ok: boolean;
  connected_account_email: string;
  expires_at: string | null;
  scopes: string[];
};

type GoogleSendEmailResponse = {
  ok: boolean;
  to_email: string;
  subject: string;
  provider_message_id: string;
};

type GmailAttachmentDraft = {
  file_name: string;
  content_type: string;
  content_base64: string;
  size_bytes: number;
};

type GoogleCalendarEventResponse = {
  ok: boolean;
  event_id: string;
  html_link: string;
  meet_link: string;
};

const providerCards = [
  {
    name: "Gmail",
    key: "gmail",
    tab: "communication",
    iconUrl: "https://img.icons8.com/color/48/gmail-new.png",
    providerGroup: "google",
    category: "Email",
    rollout: "Phase 1",
    purpose: "Send client follow-ups and log outbound communication to the CRM timeline.",
    requiredFromOwner: [
      "Google owner connection",
      "Gmail API enabled",
      "Owner-managed organization access"
    ],
    launchLevel: "Owner connects once, inherited team IDs use it"
  },
  {
    name: "Google Calendar",
    key: "google_calendar",
    tab: "calendar",
    iconUrl: "https://img.icons8.com/color/48/google-calendar--v2.png",
    providerGroup: "google",
    category: "Scheduling",
    rollout: "Phase 1",
    purpose: "Create site visits, callbacks, launches, and review meetings from deal and contact context.",
    requiredFromOwner: [
      "Google owner connection",
      "Calendar API enabled",
      "Live callback URL"
    ],
    launchLevel: "Owner-managed scheduling for the organization"
  },
  {
    name: "Google Meet",
    key: "google_meet",
    tab: "meetings",
    iconUrl: "https://img.icons8.com/color/48/google-meet.png",
    providerGroup: "google",
    category: "Meetings",
    rollout: "Phase 1",
    purpose: "Generate meeting links for walkthroughs, client reviews, and partner calls from Northstone.",
    requiredFromOwner: [
      "Google owner connection",
      "Calendar conference permissions",
      "Live callback URL"
    ],
    launchLevel: "Meet link generation through the Google stack"
  }
];

const appTabs = [
  { key: "communication", label: "Communication", iconUrl: "https://img.icons8.com/color/48/gmail-new.png" },
  { key: "meetings", label: "Meetings", iconUrl: "https://img.icons8.com/color/48/google-meet.png" },
  { key: "calendar", label: "App", iconUrl: "https://img.icons8.com/color/48/google-calendar--v2.png" },
] as const;

const comingSoonApps: Array<{
  name: string;
  tab: string;
  category: string;
  iconUrl: string;
  description: string;
}> = [];

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="muted" style={{ fontWeight: 700 }}>{title}</div>
      {items.map((item) => (
        <div key={item} className="listRow">
          <span className="tick">+</span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function statusLabel(status: string) {
  switch (status) {
    case "connected":
      return "Connected";
    case "inherited":
      return "Inherited access";
    case "ready_to_connect":
      return "Ready to connect";
    case "awaiting_owner_connection":
      return "Awaiting owner";
    case "configuration_required":
      return "Backend config needed";
    default:
      return status.replace(/_/g, " ");
  }
}

function adminAppsBanner(integrations: IntegrationsResponse | null) {
  if (integrations?.access_role === "admin") {
    return "Admin has direct control over every completed integration here. Subscription owners receive access under admin control, and employee IDs inherit what their owner allows.";
  }
  return "Enterprise and builder owners connect once, and their inherited team IDs use the same approved workspace access.";
}

function appsRequirementTitle(integrations: IntegrationsResponse | null) {
  return integrations?.access_role === "admin" ? "Admin connection control" : "Required from the owner connection";
}

function providerRequirementItems(provider: { requiredFromOwner: string[] }, integrations: IntegrationsResponse | null) {
  if (integrations?.access_role !== "admin") {
    return provider.requiredFromOwner;
  }
  return provider.requiredFromOwner.map((item) => {
    if (item === "Google owner connection") return "Google workspace connection";
    if (item === "Owner-managed organization access") return "Organization access managed by admin";
    return item;
  });
}

export default function AppsPage() {
  const [selectedTab, setSelectedTab] = useState<(typeof appTabs)[number]["key"]>("communication");
  const [integrations, setIntegrations] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleTestBusy, setGoogleTestBusy] = useState(false);
  const [googleTestResult, setGoogleTestResult] = useState<GoogleConnectionTestResponse | null>(null);
  const [microsoftBusy, setMicrosoftBusy] = useState(false);
  const [microsoftTestBusy, setMicrosoftTestBusy] = useState(false);
  const [microsoftTestResult, setMicrosoftTestResult] = useState<GoogleConnectionTestResponse | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailResult, setGmailResult] = useState<GoogleSendEmailResponse | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarResult, setCalendarResult] = useState<GoogleCalendarEventResponse | null>(null);
  const [meetBusy, setMeetBusy] = useState(false);
  const [meetResult, setMeetResult] = useState<GoogleCalendarEventResponse | null>(null);
  const [gmailForm, setGmailForm] = useState({
    to_email: "",
    subject: "",
    body_text: ""
  });
  const [gmailAttachments, setGmailAttachments] = useState<GmailAttachmentDraft[]>([]);
  const [calendarForm, setCalendarForm] = useState({
    title: "",
    description: "",
    start_at: "",
    end_at: "",
    attendee_email: "",
    timezone: "Asia/Kolkata",
    create_meet_link: true
  });
  const [meetForm, setMeetForm] = useState({
    title: "",
    description: "",
    start_at: "",
    end_at: "",
    attendee_email: "",
    timezone: "Asia/Kolkata"
  });

  const callbackState = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const integration = params.get("integration");
    const status = params.get("status");
    const detail = params.get("detail");
    if (!integration || !status) return null;
    return { integration, status, detail };
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<IntegrationsResponse>("/enterprise/integrations");
      setIntegrations(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Unable to load integration status right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!callbackState) return;
    if (callbackState.integration === "google" && callbackState.status === "connected") {
      setActionMsg(callbackState.detail ? `Google Workspace connected: ${callbackState.detail}` : "Google Workspace connected.");
      void load();
    } else if (callbackState.integration === "microsoft" && callbackState.status === "connected") {
      setActionMsg(callbackState.detail ? `Microsoft Workspace connected: ${callbackState.detail}` : "Microsoft Workspace connected.");
      void load();
    } else if (callbackState.integration === "google" && callbackState.status === "error") {
      setActionMsg(callbackState.detail ? `Google connection failed: ${callbackState.detail}` : "Google connection failed.");
    } else if (callbackState.integration === "microsoft" && callbackState.status === "error") {
      setActionMsg(callbackState.detail ? `Microsoft connection failed: ${callbackState.detail}` : "Microsoft connection failed.");
    }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("integration");
      url.searchParams.delete("status");
      url.searchParams.delete("detail");
      window.history.replaceState({}, "", url.toString());
    }
  }, [callbackState]);

  const providerByKey = useMemo(() => {
    const map = new Map<string, ProviderStatus>();
    for (const provider of integrations?.providers ?? []) {
      map.set(provider.key, provider);
    }
    return map;
  }, [integrations]);

  const googlePrimary = providerByKey.get("gmail");
  const microsoftPrimary = providerByKey.get("outlook");
  const visibleProviderCards = providerCards.filter((provider) => provider.tab === selectedTab);
  const visibleComingSoonApps = comingSoonApps.filter((app) => app.tab === selectedTab);

  async function connectGoogle() {
    setGoogleBusy(true);
    setActionMsg(null);
    try {
      const response = await api<ConnectResponse>("/integrations/google/connect");
      if (!response?.auth_url?.trim()) {
        throw new Error("Backend did not return a Google authorization URL.");
      }
      window.location.href = response.auth_url;
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to start Google connection.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function disconnectGoogle() {
    setGoogleBusy(true);
    setActionMsg(null);
    try {
      await api<{ ok: boolean }>("/integrations/google/disconnect", { method: "POST" });
      setActionMsg("Google Workspace disconnected.");
      await load();
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to disconnect Google Workspace.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function connectMicrosoft() {
    setMicrosoftBusy(true);
    setActionMsg(null);
    try {
      const response = await api<ConnectResponse>("/integrations/microsoft/connect");
      if (!response?.auth_url?.trim()) {
        throw new Error("Backend did not return a Microsoft authorization URL.");
      }
      window.location.href = response.auth_url;
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to start Microsoft connection.");
    } finally {
      setMicrosoftBusy(false);
    }
  }

  async function disconnectMicrosoft() {
    setMicrosoftBusy(true);
    setActionMsg(null);
    try {
      await api<{ ok: boolean }>("/integrations/microsoft/disconnect", { method: "POST" });
      setActionMsg("Microsoft Workspace disconnected.");
      await load();
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to disconnect Microsoft Workspace.");
    } finally {
      setMicrosoftBusy(false);
    }
  }

  async function testGoogleConnection() {
    setGoogleTestBusy(true);
    setActionMsg(null);
    try {
      const result = await api<GoogleConnectionTestResponse>("/integrations/google/test");
      setGoogleTestResult(result);
      setActionMsg(`Google Workspace connection is healthy for ${result.connected_account_email || "the connected account"}.`);
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to test Google connection.");
    } finally {
      setGoogleTestBusy(false);
    }
  }

  async function testMicrosoftConnection() {
    setMicrosoftTestBusy(true);
    setActionMsg(null);
    try {
      const result = await api<GoogleConnectionTestResponse>("/integrations/microsoft/test");
      setMicrosoftTestResult(result);
      setActionMsg(`Microsoft Workspace connection is healthy for ${result.connected_account_email || "the connected account"}.`);
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to test Microsoft connection.");
    } finally {
      setMicrosoftTestBusy(false);
    }
  }

  async function sendGoogleEmail() {
    setGmailBusy(true);
    setActionMsg(null);
    try {
      const result = await api<GoogleSendEmailResponse>("/integrations/google/gmail/send", {
        method: "POST",
        body: JSON.stringify({
          ...gmailForm,
          attachments: gmailAttachments,
        })
      });
      setGmailResult(result);
      setActionMsg(`Gmail sent to ${result.to_email}.`);
      setGmailForm((prev) => ({ ...prev, subject: "", body_text: "" }));
      setGmailAttachments([]);
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to send Gmail right now.");
    } finally {
      setGmailBusy(false);
    }
  }

  async function onGmailAttachmentPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setActionMsg(null);
    try {
      const drafts = await Promise.all(
        files.map(
          (file) =>
            new Promise<GmailAttachmentDraft>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = typeof reader.result === "string" ? reader.result : "";
                const content_base64 = result.includes(",") ? result.split(",", 2)[1] : "";
                if (!content_base64) {
                  reject(new Error(`Unable to read ${file.name}`));
                  return;
                }
                resolve({
                  file_name: file.name,
                  content_type: file.type || "application/octet-stream",
                  content_base64,
                  size_bytes: file.size,
                });
              };
              reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
              reader.readAsDataURL(file);
            })
        )
      );
      setGmailAttachments((current) => [...current, ...drafts]);
      event.target.value = "";
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Unable to attach the selected file.");
    }
  }

  function removeGmailAttachment(target: GmailAttachmentDraft) {
    setGmailAttachments((current) =>
      current.filter(
        (file) =>
          !(
            file.file_name === target.file_name &&
            file.size_bytes === target.size_bytes &&
            file.content_type === target.content_type
          )
      )
    );
  }

  async function createGoogleCalendarEvent() {
    setCalendarBusy(true);
    setActionMsg(null);
    setCalendarResult(null);
    try {
      const result = await api<GoogleCalendarEventResponse>("/integrations/google/calendar/events", {
        method: "POST",
        body: JSON.stringify(calendarForm)
      });
      setCalendarResult(result);
      setActionMsg(result.meet_link ? "Calendar event and Google Meet link created." : "Calendar event created.");
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to create Google Calendar event.");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function createGoogleMeetEvent() {
    setMeetBusy(true);
    setActionMsg(null);
    setMeetResult(null);
    try {
      const result = await api<GoogleCalendarEventResponse>("/integrations/google/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          ...meetForm,
          create_meet_link: true
        })
      });
      setMeetResult(result);
      setActionMsg(result.meet_link ? "Google Meet session created." : "Meeting event created, but no Meet link was returned.");
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to create Google Meet session.");
    } finally {
      setMeetBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="sectionHeader">
          <div>
            <div className="sectionTitle">Apps</div>
            <div className="sectionSub">
              Connect communication, meetings, documents, and workflow tools from one Northstone integrations hub.
            </div>
          </div>
        </div>
        <div className="bannerInfo">{adminAppsBanner(integrations)}</div>
        {loading ? <div className="muted" style={{ marginTop: 14 }}>Loading live integration status...</div> : null}
        {error ? <div className="bannerWarn" style={{ marginTop: 14 }}>{error}</div> : null}
        {actionMsg ? <div className="bannerInfo" style={{ marginTop: 14 }}>{actionMsg}</div> : null}
      </section>

      <section
        className="card"
        style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: 20, alignItems: "start" }}
      >
        <aside className="card" style={{ position: "sticky", top: 18 }}>
          <div className="sectionTitle" style={{ fontSize: 20 }}>Apps library</div>
          <div className="sectionSub" style={{ marginTop: 8 }}>
            Browse every tool by business domain, with separate options for Gmail, Calendar, and Meet.
          </div>
          <div className="stack" style={{ gap: 10, marginTop: 16 }}>
            {appTabs.map((tab) => {
              const isActive = selectedTab === tab.key;
              return (
                <button
                  key={tab.key}
                  className={`btn ${isActive ? "" : "secondary"}`}
                  onClick={() => setSelectedTab(tab.key)}
                  style={{ justifyContent: "flex-start", width: "100%", gap: 12, textAlign: "left", paddingLeft: 18, marginBottom: 4 }}
                >
                  <img
                    src={tab.iconUrl}
                    alt={`${tab.label} icon`}
                    width={18}
                    height={18}
                    style={{ borderRadius: 6, background: "#fff", padding: 2, flexShrink: 0 }}
                  />
                  <span style={{ display: "block", textAlign: "left", lineHeight: 1.2 }}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="stack" style={{ gap: 18 }}>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div className="sectionTitle" style={{ fontSize: 24 }}>
                  {appTabs.find((tab) => tab.key === selectedTab)?.label}
                </div>
                <div className="sectionSub" style={{ marginTop: 8 }}>
                  {selectedTab === "communication"
                    ? "Email and direct client messaging tools for follow-ups, updates, and relationship management."
                    : selectedTab === "meetings"
                      ? "Meeting platforms for walkthroughs, sales calls, investor reviews, and partner coordination."
                      : "Calendar and scheduling tools for visits, callbacks, launch planning, and client review slots."}
                </div>
              </div>
              <div className="pill enterprisePill">Apps</div>
            </div>
          </div>

          {visibleProviderCards.length > 0 ? (
            <div className="grid cols2">
              {visibleProviderCards.map((provider) => {
                const live = providerByKey.get(provider.key);
                const showGoogleActions = provider.providerGroup === "google" && !!googlePrimary;
                const showGoogleConnectionControls = showGoogleActions && provider.key === "gmail";
                const showGmailTools = showGoogleActions && provider.key === "gmail" && !!googlePrimary?.connected;
                const showCalendarTools = showGoogleActions && provider.key === "google_calendar" && !!googlePrimary?.connected;
                const showMeetTools = showGoogleActions && provider.key === "google_meet" && !!googlePrimary?.connected;
                const showMicrosoftActions = provider.key === "outlook" && !!microsoftPrimary;
                const connectedLabel = live?.connected_account_email ? `Connected as ${live.connected_account_email}` : "";
                return (
                  <article key={provider.name} className="card">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div className="row" style={{ gap: 12, alignItems: "center" }}>
                        <img
                          src={provider.iconUrl}
                          alt={`${provider.name} icon`}
                          width={28}
                          height={28}
                          style={{ borderRadius: 8, background: "#fff", padding: 4 }}
                        />
                        <div>
                          <div className="sectionTitle" style={{ fontSize: 22 }}>{provider.name}</div>
                          <div className="muted" style={{ marginTop: 6 }}>
                            {provider.category} | {provider.rollout}
                          </div>
                        </div>
                      </div>
                      <div className="pill">{live ? statusLabel(live.status) : provider.launchLevel}</div>
                    </div>
                    <p className="muted" style={{ lineHeight: 1.7, marginTop: 14 }}>{provider.purpose}</p>
                    {live?.next_step ? <div className="bannerInfo" style={{ marginTop: 14 }}>{live.next_step}</div> : null}
                    {connectedLabel ? <div className="muted" style={{ marginTop: 12 }}>{connectedLabel}</div> : null}
                    {live?.last_error ? <div className="bannerWarn" style={{ marginTop: 12 }}>{live.last_error}</div> : null}
                    {live && live.required_env.length > 0 ? (
                      <div className="bannerWarn" style={{ marginTop: 12 }}>
                        Missing backend env: {live.required_env.join(", ")}
                      </div>
                    ) : null}
                    <ListSection title={appsRequirementTitle(integrations)} items={providerRequirementItems(provider, integrations)} />

                    {showGoogleActions ? (
                      <div className="stack" style={{ gap: 14, marginTop: 18 }}>
                        {showGoogleConnectionControls ? (
                          <>
                            <div className="row" style={{ gap: 14, flexWrap: "wrap", justifyContent: "flex-start" }}>
                              {googlePrimary?.can_connect && !googlePrimary.connected ? (
                                <button className="btn" onClick={() => void connectGoogle()} disabled={googleBusy} type="button">
                                  {googleBusy ? "Connecting..." : "Connect Google Workspace"}
                                </button>
                              ) : null}
                              {googlePrimary?.connected ? (
                                <>
                                  <button className="btn" onClick={() => void testGoogleConnection()} disabled={googleTestBusy} type="button">
                                    {googleTestBusy ? "Testing..." : "Test Google connection"}
                                  </button>
                                  <button className="btn secondary" onClick={() => void disconnectGoogle()} disabled={googleBusy} type="button">
                                    {googleBusy ? "Working..." : "Disconnect Google Workspace"}
                                  </button>
                                </>
                              ) : null}
                            </div>

                            {googleTestResult ? (
                              <div className="bannerInfo">
                                Connected account: {googleTestResult.connected_account_email || "-"}
                                <br />
                                Expires at: {googleTestResult.expires_at || "Not provided"}
                                <br />
                                Scopes: {googleTestResult.scopes.join(", ") || "None reported"}
                              </div>
                            ) : null}
                          </>
                        ) : null}

                        {showGmailTools ? (
                          <>
                            <div className="card">
                              <div className="sectionTitle" style={{ fontSize: 18 }}>Send Gmail</div>
                              <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                                <label>
                                  Recipient email
                                  <input
                                    value={gmailForm.to_email}
                                    onChange={(e) => setGmailForm((prev) => ({ ...prev, to_email: e.target.value }))}
                                    placeholder="client@example.com"
                                  />
                                </label>
                                <label>
                                  Subject
                                  <input
                                    value={gmailForm.subject}
                                    onChange={(e) => setGmailForm((prev) => ({ ...prev, subject: e.target.value }))}
                                    placeholder="Project update from Northstone"
                                  />
                                </label>
                                <label>
                                  Message
                                  <textarea
                                    value={gmailForm.body_text}
                                    onChange={(e) => setGmailForm((prev) => ({ ...prev, body_text: e.target.value }))}
                                    placeholder="Write your client follow-up here..."
                                    rows={5}
                                  />
                                </label>
                                <div className="stack" style={{ gap: 10 }}>
                                  <label>
                                    Attach files
                                    <input
                                      type="file"
                                      multiple
                                      onChange={(e) => void onGmailAttachmentPick(e)}
                                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar"
                                    />
                                  </label>
                                  <div className="muted">
                                    Add images, PDFs, documents, spreadsheets, presentations, or zip references. Total attachment size should stay under 10 MB.
                                  </div>
                                  {gmailAttachments.length ? (
                                    <div className="stack" style={{ gap: 8 }}>
                                      {gmailAttachments.map((file) => (
                                        <div
                                          key={`${file.file_name}-${file.size_bytes}-${file.content_type}`}
                                          className="row"
                                          style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
                                        >
                                          <div>
                                            {file.file_name} ({Math.max(1, Math.round(file.size_bytes / 1024))} KB)
                                          </div>
                                          <button className="btn ghost" type="button" onClick={() => removeGmailAttachment(file)}>
                                            Remove
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                                <button
                                  className="btn"
                                  onClick={() => void sendGoogleEmail()}
                                  disabled={gmailBusy || !gmailForm.to_email.trim() || !gmailForm.subject.trim() || !gmailForm.body_text.trim()}
                                >
                                  {gmailBusy ? "Sending..." : "Send Gmail"}
                                </button>
                                {gmailResult ? (
                                  <div className="bannerInfo">
                                    Sent to {gmailResult.to_email}
                                    <br />
                                    Message id: {gmailResult.provider_message_id || "Returned successfully"}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </>
                        ) : null}

                        {showCalendarTools ? (
                          <div className="card">
                            <div className="sectionTitle" style={{ fontSize: 18 }}>Create Google Calendar event</div>
                            <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                              <label>
                                Event title
                                <input
                                  value={calendarForm.title}
                                  onChange={(e) => setCalendarForm((prev) => ({ ...prev, title: e.target.value }))}
                                  placeholder="Client walkthrough"
                                />
                              </label>
                              <label>
                                Description
                                <textarea
                                  value={calendarForm.description}
                                  onChange={(e) => setCalendarForm((prev) => ({ ...prev, description: e.target.value }))}
                                  placeholder="Meeting notes, property details, and agenda"
                                  rows={4}
                                />
                              </label>
                              <div className="grid cols2">
                                <label>
                                  Start date and time
                                  <input
                                    type="datetime-local"
                                    value={calendarForm.start_at}
                                    onChange={(e) => setCalendarForm((prev) => ({ ...prev, start_at: e.target.value }))}
                                  />
                                </label>
                                <label>
                                  End date and time
                                  <input
                                    type="datetime-local"
                                    value={calendarForm.end_at}
                                    onChange={(e) => setCalendarForm((prev) => ({ ...prev, end_at: e.target.value }))}
                                  />
                                </label>
                              </div>
                              <label>
                                Attendee email
                                <input
                                  value={calendarForm.attendee_email}
                                  onChange={(e) => setCalendarForm((prev) => ({ ...prev, attendee_email: e.target.value }))}
                                  placeholder="client@example.com"
                                />
                              </label>
                              <label>
                                Timezone
                                <input
                                  value={calendarForm.timezone}
                                  onChange={(e) => setCalendarForm((prev) => ({ ...prev, timezone: e.target.value }))}
                                  placeholder="Asia/Kolkata"
                                />
                              </label>
                              <label className="row" style={{ gap: 10, alignItems: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={calendarForm.create_meet_link}
                                  onChange={(e) => setCalendarForm((prev) => ({ ...prev, create_meet_link: e.target.checked }))}
                                />
                                <span>Create Google Meet link</span>
                              </label>
                              <button
                                className="btn"
                                onClick={() => void createGoogleCalendarEvent()}
                                disabled={calendarBusy || !calendarForm.title.trim() || !calendarForm.start_at || !calendarForm.end_at}
                              >
                                {calendarBusy ? "Creating..." : "Create calendar event"}
                              </button>
                              {!calendarBusy && (!calendarForm.title.trim() || !calendarForm.start_at || !calendarForm.end_at) ? (
                                <div className="muted">
                                  Fill event title, start time, and end time to enable calendar creation.
                                </div>
                              ) : null}
                              {calendarResult ? (
                                <div className="bannerInfo">
                                  Event created: {calendarResult.event_id}
                                  <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                                    {calendarResult.html_link ? (
                                      <a
                                        className="btn secondary"
                                        href={calendarResult.html_link}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ textDecoration: "none" }}
                                      >
                                        Open event
                                      </a>
                                    ) : null}
                                    {calendarResult.meet_link ? (
                                      <a
                                        className="btn"
                                        href={calendarResult.meet_link}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ textDecoration: "none" }}
                                      >
                                        Join meeting
                                      </a>
                                    ) : null}
                                  </div>
                                  {!calendarResult.meet_link ? <div style={{ marginTop: 10 }}>Meet link not requested for this event.</div> : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        {showMeetTools ? (
                          <div className="card">
                            <div className="sectionTitle" style={{ fontSize: 18 }}>Create Google Meet session</div>
                            <div className="sectionSub" style={{ marginTop: 8 }}>
                              Northstone creates Google Meet links through a connected Google Calendar event.
                            </div>
                            <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                              <label>
                                Meeting title
                                <input
                                  value={meetForm.title}
                                  onChange={(e) => setMeetForm((prev) => ({ ...prev, title: e.target.value }))}
                                  placeholder="Sales review call"
                                />
                              </label>
                              <label>
                                Meeting description
                                <textarea
                                  value={meetForm.description}
                                  onChange={(e) => setMeetForm((prev) => ({ ...prev, description: e.target.value }))}
                                  placeholder="Agenda, property notes, and call purpose"
                                  rows={4}
                                />
                              </label>
                              <div className="grid cols2">
                                <label>
                                  Start date and time
                                  <input
                                    type="datetime-local"
                                    value={meetForm.start_at}
                                    onChange={(e) => setMeetForm((prev) => ({ ...prev, start_at: e.target.value }))}
                                  />
                                </label>
                                <label>
                                  End date and time
                                  <input
                                    type="datetime-local"
                                    value={meetForm.end_at}
                                    onChange={(e) => setMeetForm((prev) => ({ ...prev, end_at: e.target.value }))}
                                  />
                                </label>
                              </div>
                              <label>
                                Attendee email
                                <input
                                  value={meetForm.attendee_email}
                                  onChange={(e) => setMeetForm((prev) => ({ ...prev, attendee_email: e.target.value }))}
                                  placeholder="client@example.com"
                                />
                              </label>
                              <label>
                                Timezone
                                <input
                                  value={meetForm.timezone}
                                  onChange={(e) => setMeetForm((prev) => ({ ...prev, timezone: e.target.value }))}
                                  placeholder="Asia/Kolkata"
                                />
                              </label>
                              <button
                                className="btn"
                                onClick={() => void createGoogleMeetEvent()}
                                disabled={meetBusy || !meetForm.title.trim() || !meetForm.start_at || !meetForm.end_at}
                              >
                                {meetBusy ? "Creating..." : "Create Google Meet"}
                              </button>
                              {!meetBusy && (!meetForm.title.trim() || !meetForm.start_at || !meetForm.end_at) ? (
                                <div className="muted">
                                  Fill meeting title, start time, and end time to enable Meet creation.
                                </div>
                              ) : null}
                              {meetResult ? (
                                <div className="bannerInfo">
                                  Event created: {meetResult.event_id}
                                  <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                                    {meetResult.html_link ? (
                                      <a
                                        className="btn secondary"
                                        href={meetResult.html_link}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ textDecoration: "none" }}
                                      >
                                        Open event
                                      </a>
                                    ) : null}
                                    {meetResult.meet_link ? (
                                      <a
                                        className="btn"
                                        href={meetResult.meet_link}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ textDecoration: "none" }}
                                      >
                                        Join meeting
                                      </a>
                                    ) : null}
                                  </div>
                                  {!meetResult.meet_link ? <div style={{ marginTop: 10 }}>Google did not return a Meet link for this event.</div> : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {showMicrosoftActions ? (
                      <div className="stack" style={{ gap: 14, marginTop: 18 }}>
                        <div className="row" style={{ gap: 14, flexWrap: "wrap", justifyContent: "flex-start" }}>
                          {microsoftPrimary?.can_connect && !microsoftPrimary.connected ? (
                            <button className="btn" onClick={() => void connectMicrosoft()} disabled={microsoftBusy} type="button">
                              {microsoftBusy ? "Connecting..." : "Connect Microsoft Workspace"}
                            </button>
                          ) : null}
                          {microsoftPrimary?.connected ? (
                            <>
                              <button className="btn" onClick={() => void testMicrosoftConnection()} disabled={microsoftTestBusy} type="button">
                                {microsoftTestBusy ? "Testing..." : "Test Microsoft connection"}
                              </button>
                              <button className="btn secondary" onClick={() => void disconnectMicrosoft()} disabled={microsoftBusy} type="button">
                                {microsoftBusy ? "Working..." : "Disconnect Microsoft Workspace"}
                              </button>
                            </>
                          ) : null}
                        </div>
                        {microsoftTestResult ? (
                          <div className="bannerInfo">
                            Connected account: {microsoftTestResult.connected_account_email || "-"}
                            <br />
                            Expires at: {microsoftTestResult.expires_at || "Not provided"}
                            <br />
                            Scopes: {microsoftTestResult.scopes.join(", ") || "None reported"}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                  </article>
                );
              })}
            </div>
          ) : null}

          {visibleComingSoonApps.length > 0 ? (
            <div className="grid cols2">
              {visibleComingSoonApps.map((app) => (
                <article key={app.name} className="card">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div className="row" style={{ gap: 12, alignItems: "center" }}>
                      <img
                        src={app.iconUrl}
                        alt={`${app.name} icon`}
                        width={28}
                        height={28}
                        style={{ borderRadius: 8, background: "#fff", padding: 4 }}
                      />
                      <div>
                        <div className="sectionTitle" style={{ fontSize: 22 }}>{app.name}</div>
                        <div className="muted" style={{ marginTop: 6 }}>{app.category}</div>
                      </div>
                    </div>
                    <div className="pill">Coming soon</div>
                  </div>
                  <p className="muted" style={{ lineHeight: 1.7, marginTop: 14 }}>{app.description}</p>
                </article>
              ))}
            </div>
          ) : null}

        </div>
      </section>
    </div>
  );
}
