import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  API_BASE_URL,
  deleteLeadCaptureMapping,
  getGoogleCalendarAuthUrl,
  getGoogleCalendarStatus,
  getLeadCaptureOverview,
  saveLeadCaptureMapping,
  syncAllGoogleCalendarActivities,
  toggleGoogleCalendarSync,
} from "../api/client";
import type { GoogleCalendarSyncStatus, IntegrationMapping, LeadCaptureOverview } from "../api/types";

type PlatformDraft = {
  platform_id: string;
  access_token: string;
};

const webhookUrls = {
  facebook: `${API_BASE_URL}/webhooks/facebook-leads`,
  google: `${API_BASE_URL}/webhooks/google-leads`,
};

function sourceCount(overview: LeadCaptureOverview | null, key: string) {
  return overview?.counts?.[key] ?? 0;
}

function sourceRecent(overview: LeadCaptureOverview | null, key: string) {
  return overview?.recent_by_source?.[key] ?? [];
}

function platformLabel(platform: "facebook" | "google") {
  return platform === "facebook" ? "Facebook Ads" : "Google Ads";
}

export default function IntegrationsSetupPage() {
  const [overview, setOverview] = useState<LeadCaptureOverview | null>(null);
  const [calendarStatus, setCalendarStatus] = useState<GoogleCalendarSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlatform, setBusyPlatform] = useState<"facebook" | "google" | null>(null);
  const [drafts, setDrafts] = useState<Record<"facebook" | "google", PlatformDraft>>({
    facebook: { platform_id: "", access_token: "" },
    google: { platform_id: "", access_token: "" },
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [data, calendar] = await Promise.all([getLeadCaptureOverview(), getGoogleCalendarStatus()]);
      setOverview(data);
      setCalendarStatus(calendar);
      setDrafts((current) => {
        const next = { ...current };
        for (const platform of ["facebook", "google"] as const) {
          const mapping = data.mappings.find((item) => item.platform === platform);
          next[platform] = {
            platform_id: mapping?.platform_id ?? current[platform].platform_id,
            access_token: current[platform].access_token,
          };
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Unable to load lead capture integrations right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const mappingsByPlatform = useMemo(() => {
    const map = new Map<string, IntegrationMapping>();
    for (const mapping of overview?.mappings ?? []) map.set(mapping.platform, mapping);
    return map;
  }, [overview]);

  async function connectGoogleCalendar() {
    setBusyPlatform("google");
    setActionMsg(null);
    try {
      const data = await getGoogleCalendarAuthUrl();
      window.location.href = data.auth_url;
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to start Google Calendar connection right now.");
      setBusyPlatform(null);
    }
  }

  async function handleCalendarToggle(enabled: boolean) {
    setBusyPlatform("google");
    setActionMsg(null);
    try {
      const updated = await toggleGoogleCalendarSync(enabled);
      setCalendarStatus(updated);
      setActionMsg(`Google Calendar auto-sync ${enabled ? "enabled" : "paused"}.`);
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to update Google Calendar sync right now.");
    } finally {
      setBusyPlatform(null);
    }
  }

  async function handleSyncAll() {
    setBusyPlatform("google");
    setActionMsg(null);
    try {
      const result = await syncAllGoogleCalendarActivities();
      setActionMsg(`Google Calendar sync completed. Synced ${result.synced_count} activities, skipped ${result.skipped_count}.`);
      const refreshed = await getGoogleCalendarStatus();
      setCalendarStatus(refreshed);
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to sync activities to Google Calendar right now.");
    } finally {
      setBusyPlatform(null);
    }
  }

  async function handleSave(platform: "facebook" | "google") {
    const draft = drafts[platform];
    if (!draft.platform_id.trim()) {
      setActionMsg(`${platformLabel(platform)} requires a platform id before saving.`);
      return;
    }
    setBusyPlatform(platform);
    setActionMsg(null);
    try {
      await saveLeadCaptureMapping({
        platform,
        platform_id: draft.platform_id.trim(),
        access_token: draft.access_token.trim(),
      });
      setDrafts((current) => ({
        ...current,
        [platform]: { ...current[platform], access_token: "" },
      }));
      setActionMsg(`${platformLabel(platform)} mapping saved.`);
      await load();
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : `Unable to save ${platformLabel(platform)} right now.`);
    } finally {
      setBusyPlatform(null);
    }
  }

  async function handleDelete(platform: "facebook" | "google") {
    const mapping = mappingsByPlatform.get(platform);
    if (!mapping) return;
    setBusyPlatform(platform);
    setActionMsg(null);
    try {
      await deleteLeadCaptureMapping(mapping.id);
      setActionMsg(`${platformLabel(platform)} mapping removed.`);
      await load();
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : `Unable to remove ${platformLabel(platform)} right now.`);
    } finally {
      setBusyPlatform(null);
    }
  }

  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setActionMsg(`${label} copied.`);
    } catch {
      setActionMsg(`Unable to copy ${label.toLowerCase()} right now.`);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="sectionHeader">
          <div>
            <div className="sectionTitle">Lead Capture Integrations</div>
            <div className="sectionSub">
              Connect Facebook and Google lead forms so Northstone creates contacts and deals automatically the moment a prospect submits.
            </div>
          </div>
        </div>
        {loading ? <div className="muted">Loading lead capture setup...</div> : null}
        {error ? <div className="bannerWarn">{error}</div> : null}
        {actionMsg ? <div className="bannerInfo">{actionMsg}</div> : null}
      </section>

      <section className="grid cols2">
        {(["facebook", "google"] as const).map((platform) => {
          const mapping = mappingsByPlatform.get(platform);
          const sourceKey = platform === "facebook" ? "facebook_ads" : "google_ads";
          const recent = sourceRecent(overview, sourceKey);
          const placeholderToken = platform === "facebook" ? "Page access token" : "Webhook secret (optional if env is set)";
          const platformIdLabel = platform === "facebook" ? "Page ID" : "Customer ID";

          return (
            <article key={platform} className="card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                <div>
                  <div className="sectionTitle" style={{ fontSize: 24 }}>{platformLabel(platform)}</div>
                  <div className="muted" style={{ marginTop: 8 }}>
                    {platform === "facebook"
                      ? "Meta lead ads post into this webhook, and Northstone fetches full lead fields before creating CRM records."
                      : "Google lead forms post directly into Northstone using the webhook key below."}
                  </div>
                </div>
                <div className={`pill ${mapping ? "enterprisePill" : ""}`}>{mapping ? "Connected" : "Not connected"}</div>
              </div>

              <div className="grid cols2" style={{ marginTop: 18 }}>
                <label>
                  {platformIdLabel}
                  <input
                    value={drafts[platform].platform_id}
                    onChange={(e) => setDrafts((current) => ({ ...current, [platform]: { ...current[platform], platform_id: e.target.value } }))}
                    placeholder={platform === "facebook" ? "123456789012345" : "123-456-7890"}
                  />
                </label>
                <label>
                  {platform === "facebook" ? "Access token" : "Webhook key"}
                  <input
                    value={drafts[platform].access_token}
                    onChange={(e) => setDrafts((current) => ({ ...current, [platform]: { ...current[platform], access_token: e.target.value } }))}
                    placeholder={placeholderToken}
                  />
                </label>
              </div>

              <div className="row" style={{ gap: 12, flexWrap: "wrap", marginTop: 14 }}>
                <button className="btn" type="button" disabled={busyPlatform === platform} onClick={() => void handleSave(platform)}>
                  {busyPlatform === platform ? "Saving..." : "Save connection"}
                </button>
                {mapping ? (
                  <button className="btn secondary" type="button" disabled={busyPlatform === platform} onClick={() => void handleDelete(platform)}>
                    Remove mapping
                  </button>
                ) : null}
              </div>

              <div className="bannerInfo" style={{ marginTop: 16 }}>
                Webhook URL: <strong>{webhookUrls[platform]}</strong>
                <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  <button className="btn ghost" type="button" onClick={() => void copyValue(webhookUrls[platform], `${platformLabel(platform)} webhook URL`)}>
                    Copy webhook URL
                  </button>
                  {mapping?.platform_id ? (
                    <button className="btn ghost" type="button" onClick={() => void copyValue(mapping.platform_id, `${platformLabel(platform)} platform id`)}>
                      Copy {platformIdLabel}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="row" style={{ justifyContent: "space-between", marginTop: 18 }}>
                <div className="muted">Leads captured</div>
                <div className="sectionTitle" style={{ fontSize: 22 }}>{sourceCount(overview, sourceKey)}</div>
              </div>

              <div className="stack" style={{ gap: 10, marginTop: 16 }}>
                <div className="muted" style={{ fontWeight: 700 }}>Last 5 leads</div>
                {recent.length === 0 ? <div className="muted">No leads captured yet.</div> : null}
                {recent.map((lead) => (
                  <div key={lead.deal_id} className="listRow" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{lead.contact_name}</div>
                      <div className="muted">{lead.contact_phone || "Phone not provided"}</div>
                    </div>
                    <div className="muted">{new Date(lead.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </section>

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <div className="sectionTitle" style={{ fontSize: 24 }}>Google Calendar Sync</div>
            <div className="muted" style={{ marginTop: 8 }}>
              Connect once, then let Northstone push upcoming activities into Google Calendar and keep future edits aligned.
            </div>
          </div>
          <div className={`pill ${calendarStatus?.connected ? "enterprisePill" : ""}`}>
            {calendarStatus?.connected ? "Connected" : "Not connected"}
          </div>
        </div>

        <div className="bannerInfo">
          Callback URL: <strong>{API_BASE_URL}/integrations/google/callback</strong>
        </div>

        {calendarStatus?.connected ? (
          <>
            <div className="grid cols2">
              <div className="card">
                <div className="muted">Connected email</div>
                <div className="sectionTitle" style={{ fontSize: 20, marginTop: 8 }}>{calendarStatus.connected_email || "Unknown"}</div>
              </div>
              <div className="card">
                <div className="muted">Synced events</div>
                <div className="sectionTitle" style={{ fontSize: 20, marginTop: 8 }}>{calendarStatus.synced_events_count}</div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {calendarStatus.last_sync_at ? `Last sync: ${new Date(calendarStatus.last_sync_at).toLocaleString()}` : "No sync has run yet."}
                </div>
              </div>
            </div>

            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <button className="btn" type="button" disabled={busyPlatform === "google"} onClick={() => void handleSyncAll()}>
                {busyPlatform === "google" ? "Syncing..." : "Sync All Activities"}
              </button>
              <button className="btn secondary" type="button" disabled={busyPlatform === "google"} onClick={() => void handleCalendarToggle(!Boolean(calendarStatus.sync_enabled))}>
                {calendarStatus.sync_enabled ? "Pause auto-sync" : "Enable auto-sync"}
              </button>
            </div>
            <div className="muted">
              Auto-sync new activities: <strong>{calendarStatus.sync_enabled ? "On" : "Off"}</strong>
              {calendarStatus.token_expiry ? ` • token expires ${new Date(calendarStatus.token_expiry).toLocaleString()}` : ""}
            </div>
          </>
        ) : (
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <button className="btn" type="button" disabled={busyPlatform === "google"} onClick={() => void connectGoogleCalendar()}>
              {busyPlatform === "google" ? "Opening..." : "Connect Google Calendar"}
            </button>
            {calendarStatus?.auth_url ? (
              <button className="btn ghost" type="button" onClick={() => void copyValue(calendarStatus.auth_url, "Google Calendar auth URL")}>
                Copy auth URL
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
