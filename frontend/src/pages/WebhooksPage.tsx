import { useEffect, useMemo, useState } from "react";

import {
  API_BASE_URL,
  ApiError,
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  listWebhookEndpoints,
  listWebhookLogs,
  updateWebhookEndpoint,
} from "../api/client";
import type { WebhookEndpoint, WebhookLog } from "../api/types";

type MappingRow = {
  target: string;
  source: string;
};

const defaultRows: MappingRow[] = [
  { target: "name", source: "contact_name" },
  { target: "phone", source: "phone" },
  { target: "email", source: "email" },
  { target: "deal_title", source: "project_name" },
];

function endpointUrl(webhookKey: string) {
  return `${API_BASE_URL}/webhooks/inbound/${webhookKey}`;
}

function mappingRowsFromRecord(record: Record<string, string>) {
  const rows = Object.entries(record).map(([target, source]) => ({ target, source }));
  return rows.length ? rows : defaultRows;
}

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [logsByEndpoint, setLogsByEndpoint] = useState<Record<string, WebhookLog[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [openLogsFor, setOpenLogsFor] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mappingRows, setMappingRows] = useState<MappingRow[]>(defaultRows);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await listWebhookEndpoints();
      setEndpoints(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Unable to load webhooks right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadLogs(endpointId: string) {
    setBusyId(endpointId);
    setActionMsg(null);
    try {
      const rows = await listWebhookLogs(endpointId);
      setLogsByEndpoint((current) => ({ ...current, [endpointId]: rows }));
      setOpenLogsFor(endpointId);
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to load webhook logs right now.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate() {
    if (!name.trim()) {
      setActionMsg("Webhook name is required.");
      return;
    }
    const fieldMapping = Object.fromEntries(mappingRows.filter((row) => row.target.trim() && row.source.trim()).map((row) => [row.target.trim(), row.source.trim()]));
    setBusyId("create");
    setActionMsg(null);
    try {
      const created = await createWebhookEndpoint({ name: name.trim(), field_mapping: fieldMapping });
      setEndpoints((current) => [created, ...current]);
      setName("");
      setMappingRows(defaultRows);
      setShowCreate(false);
      setActionMsg("Webhook endpoint created.");
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to create webhook endpoint right now.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(endpoint: WebhookEndpoint) {
    setBusyId(endpoint.id);
    setActionMsg(null);
    try {
      const updated = await updateWebhookEndpoint(endpoint.id, { is_active: !endpoint.is_active });
      setEndpoints((current) => current.map((row) => (row.id === endpoint.id ? updated : row)));
      setActionMsg(`${endpoint.name} ${updated.is_active ? "reactivated" : "paused"}.`);
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to update webhook right now.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeactivate(endpoint: WebhookEndpoint) {
    setBusyId(endpoint.id);
    setActionMsg(null);
    try {
      await deactivateWebhookEndpoint(endpoint.id);
      setEndpoints((current) => current.map((row) => (row.id === endpoint.id ? { ...row, is_active: false } : row)));
      setActionMsg(`${endpoint.name} deactivated.`);
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : "Unable to deactivate webhook right now.");
    } finally {
      setBusyId(null);
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

  const activeCount = useMemo(() => endpoints.filter((item) => item.is_active).length, [endpoints]);

  return (
    <div className="stack">
      <section className="card">
        <div className="sectionHeader">
          <div>
            <div className="sectionTitle">Webhook Automation Layer</div>
            <div className="sectionSub">
              Accept leads from Zapier, Make, custom forms, and scripts. Map incoming payload fields once, then let Northstone create contacts and deals automatically.
            </div>
          </div>
          <button className="btn" type="button" onClick={() => setShowCreate((current) => !current)}>
            {showCreate ? "Close builder" : "Create Webhook"}
          </button>
        </div>
        <div className="row muted" style={{ gap: 16, flexWrap: "wrap" }}>
          <span>Total endpoints: {endpoints.length}</span>
          <span>Active: {activeCount}</span>
          <span>Inbound base: {API_BASE_URL}/webhooks/inbound/...</span>
        </div>
        {error ? <div className="bannerWarn">{error}</div> : null}
        {actionMsg ? <div className="bannerInfo">{actionMsg}</div> : null}
      </section>

      {showCreate ? (
        <section className="card stack">
          <div className="sectionTitle" style={{ fontSize: 22 }}>Create inbound webhook</div>
          <label>
            Webhook name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Zapier buyer intake" />
          </label>
          <div className="stack">
            <div className="muted" style={{ fontWeight: 700 }}>Field mapping</div>
            {mappingRows.map((row, index) => (
              <div key={`${row.target}-${index}`} className="grid cols2">
                <label>
                  Northstone field
                  <input
                    value={row.target}
                    onChange={(e) =>
                      setMappingRows((current) =>
                        current.map((item, itemIndex) => (itemIndex === index ? { ...item, target: e.target.value } : item)),
                      )
                    }
                    placeholder="name"
                  />
                </label>
                <label>
                  Incoming payload key
                  <input
                    value={row.source}
                    onChange={(e) =>
                      setMappingRows((current) =>
                        current.map((item, itemIndex) => (itemIndex === index ? { ...item, source: e.target.value } : item)),
                      )
                    }
                    placeholder="contact_name"
                  />
                </label>
              </div>
            ))}
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <button className="btn secondary" type="button" onClick={() => setMappingRows((current) => [...current, { target: "", source: "" }])}>
                Add mapping row
              </button>
              {mappingRows.length > 1 ? (
                <button className="btn ghost" type="button" onClick={() => setMappingRows((current) => current.slice(0, -1))}>
                  Remove last row
                </button>
              ) : null}
            </div>
          </div>
          <div className="bannerInfo">
            Zapier setup: create a Catch Hook step, copy the inbound URL after creation, then map your source fields into the keys you define here. Northstone will create a contact, deal, and webhook capture activity automatically.
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <button className="btn" type="button" disabled={busyId === "create"} onClick={() => void handleCreate()}>
              {busyId === "create" ? "Creating..." : "Create endpoint"}
            </button>
            <button className="btn ghost" type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <section className="card stack">
        <div className="sectionTitle" style={{ fontSize: 22 }}>Existing webhook endpoints</div>
        {loading ? <div className="muted">Loading endpoints...</div> : null}
        {!loading && endpoints.length === 0 ? <div className="muted">No webhook endpoints yet. Create one to start accepting external leads.</div> : null}
        {endpoints.map((endpoint) => {
          const isBusy = busyId === endpoint.id;
          const logs = logsByEndpoint[endpoint.id] ?? [];
          return (
            <article key={endpoint.id} className="card webhookCard">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                <div>
                  <div className="sectionTitle" style={{ fontSize: 22 }}>{endpoint.name}</div>
                  <div className="muted" style={{ marginTop: 8 }}>
                    Created {new Date(endpoint.created_at).toLocaleString()}
                    {endpoint.last_triggered_at ? ` • last triggered ${new Date(endpoint.last_triggered_at).toLocaleString()}` : ""}
                  </div>
                </div>
                <div className={`pill ${endpoint.is_active ? "enterprisePill" : ""}`}>{endpoint.is_active ? "Active" : "Paused"}</div>
              </div>

              <div className="bannerInfo" style={{ marginTop: 14 }}>
                <strong>Inbound URL</strong>
                <div className="monoLine">{endpointUrl(endpoint.webhook_key)}</div>
                <div className="row" style={{ gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                  <button className="btn ghost" type="button" onClick={() => void copyValue(endpointUrl(endpoint.webhook_key), `${endpoint.name} inbound URL`)}>
                    Copy URL
                  </button>
                  <button className="btn ghost" type="button" onClick={() => void copyValue(JSON.stringify(endpoint.field_mapping, null, 2), `${endpoint.name} field mapping`)}>
                    Copy mapping JSON
                  </button>
                </div>
              </div>

              <div className="stack" style={{ gap: 8 }}>
                <div className="muted" style={{ fontWeight: 700 }}>Field mapping</div>
                {mappingRowsFromRecord(endpoint.field_mapping).map((row) => (
                  <div key={`${endpoint.id}-${row.target}-${row.source}`} className="listRow">
                    <span>{row.target}</span>
                    <span className="muted">← {row.source}</span>
                  </div>
                ))}
              </div>

              <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                <button className="btn secondary" type="button" disabled={isBusy} onClick={() => void handleToggle(endpoint)}>
                  {isBusy ? "Updating..." : endpoint.is_active ? "Pause endpoint" : "Reactivate endpoint"}
                </button>
                <button className="btn ghost" type="button" disabled={isBusy} onClick={() => void loadLogs(endpoint.id)}>
                  {isBusy ? "Loading..." : "View logs"}
                </button>
                <button className="btn ghost" type="button" disabled={isBusy || !endpoint.is_active} onClick={() => void handleDeactivate(endpoint)}>
                  Deactivate
                </button>
              </div>

              {openLogsFor === endpoint.id ? (
                <div className="stack webhookLogs">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div className="muted" style={{ fontWeight: 700 }}>Last 50 hits</div>
                    <button className="btn ghost" type="button" onClick={() => setOpenLogsFor(null)}>
                      Close logs
                    </button>
                  </div>
                  {logs.length === 0 ? <div className="muted">No webhook hits yet.</div> : null}
                  {logs.map((log) => (
                    <div key={log.id} className="card webhookLogRow">
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <div className={`pill ${log.status === "ok" ? "enterprisePill" : ""}`}>{log.status}</div>
                        <div className="muted">{new Date(log.created_at).toLocaleString()}</div>
                      </div>
                      <div className="monoPreview">{log.payload_preview}</div>
                      <div className="muted">
                        {log.created_contact_id ? `Contact: ${log.created_contact_id}` : "No contact linked"}
                        {" • "}
                        {log.created_deal_id ? `Deal: ${log.created_deal_id}` : "No deal linked"}
                      </div>
                      {log.error_message ? <div className="bannerWarn">{log.error_message}</div> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
