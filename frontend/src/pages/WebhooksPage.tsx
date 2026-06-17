// MODIFIED: Enterprise sidebar wiring — Replaces the dead Webhooks placeholder with a live operator page that exposes the real inbound URLs teams need to paste into portal and WhatsApp providers.
import { useMemo, useState } from "react";

import { API_BASE_URL } from "../api/client";

type WebhookItem = {
  key: string;
  name: string;
  method: string;
  url: string;
  purpose: string;
};

export default function WebhooksPage() {
  const [message, setMessage] = useState<string | null>(null);

  const items = useMemo<WebhookItem[]>(
    () => [
      {
        key: "99acres",
        name: "99acres lead intake",
        method: "POST",
        url: `${API_BASE_URL}/portal-leads/ingest/99acres`,
        purpose: "Creates or matches a contact and opens a CRM deal from 99acres lead submissions.",
      },
      {
        key: "magicbricks",
        name: "MagicBricks lead intake",
        method: "POST",
        url: `${API_BASE_URL}/portal-leads/ingest/magicbricks`,
        purpose: "Captures MagicBricks portal leads and pushes them into the default CRM pipeline stage.",
      },
      {
        key: "whatsapp-verify",
        name: "WhatsApp Cloud webhook",
        method: "GET / POST",
        url: `${API_BASE_URL}/whatsapp/webhook`,
        purpose: "Meta uses this endpoint for webhook verification and inbound WhatsApp message delivery.",
      },
    ],
    [],
  );

  async function copyUrl(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Webhook URL copied.");
      window.setTimeout(() => setMessage(null), 2400);
    } catch {
      setMessage("Could not copy this URL automatically.");
      window.setTimeout(() => setMessage(null), 2400);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Webhooks</div>
          <div className="muted">Copy the live CRM ingestion URLs your lead providers and messaging channels need.</div>
        </div>
      </div>

      {message ? <div className="alert ok">{message}</div> : null}

      <section className="card card-pad">
        <div className="cardTitle">Active webhook endpoints</div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Method</th>
                <th>Endpoint</th>
                <th>Purpose</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key}>
                  <td className="tdTitle">{item.name}</td>
                  <td>{item.method}</td>
                  <td style={{ minWidth: 320, wordBreak: "break-all" }}>{item.url}</td>
                  <td>{item.purpose}</td>
                  <td>
                    <button className="btn ghost" type="button" onClick={() => void copyUrl(item.url)}>
                      Copy URL
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sequenceBuilderLayout">
        <div className="card card-pad">
          <div className="cardTitle">Provider setup note</div>
          <div className="muted">
            Paste the 99acres and MagicBricks URLs into their developer or lead-postback dashboards. For WhatsApp Cloud,
            set the webhook callback to the WhatsApp endpoint above and use the same backend verify token configured on the server.
          </div>
        </div>
        <div className="card card-pad">
          <div className="cardTitle">Safety checks</div>
          <div className="muted">
            These are live production endpoints on <b>{API_BASE_URL}</b>. Only share them with verified providers and keep any
            related provider tokens or verify secrets in the backend environment.
          </div>
        </div>
      </section>
    </div>
  );
}
