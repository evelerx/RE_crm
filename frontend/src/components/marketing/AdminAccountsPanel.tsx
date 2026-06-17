// MODIFIED: Marketing admin controls — live account pool, allotment, revoke, audit, and request queue panel for admin marketing portal assignment.
import { useEffect, useMemo, useState } from "react";

import {
  allotAdminMarketingAccount,
  createAdminMarketingAccount,
  listAdminMarketingAccountAudit,
  listAdminMarketingAccounts,
  listAdminMarketingRequests,
  revokeAdminMarketingAccount,
} from "../../api/client";
import type { AdminMarketingRequestRow, MarketingAccount, MarketingAccountAllotment } from "../../types/marketing";

type OwnerOption = {
  id: string;
  email: string;
  company: string;
  plan: string;
};

type Props = {
  owners: OwnerOption[];
};

const EMPTY_FORM = {
  platform: "meta",
  account_name: "",
  external_account_id: "",
  notes: "",
};

function fmtDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function AdminAccountsPanel({ owners }: Props) {
  const [accounts, setAccounts] = useState<MarketingAccount[]>([]);
  const [audit, setAudit] = useState<MarketingAccountAllotment[]>([]);
  const [requests, setRequests] = useState<AdminMarketingRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedOwners, setSelectedOwners] = useState<Record<string, string>>({});
  const [notesByAccount, setNotesByAccount] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [accountsRes, auditRes, requestsRes] = await Promise.all([
        listAdminMarketingAccounts(),
        listAdminMarketingAccountAudit(),
        listAdminMarketingRequests(),
      ]);
      setAccounts(accountsRes);
      setAudit(auditRes);
      setRequests(requestsRes);
      setSelectedOwners((current) => {
        const next = { ...current };
        accountsRes.forEach((row) => {
          if (!next[row.id]) {
            next[row.id] = row.allotted_to_owner_id || owners[0]?.id || "";
          }
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load marketing account controls");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const availableCount = useMemo(() => accounts.filter((row) => row.status === "available").length, [accounts]);
  const allottedCount = accounts.length - availableCount;

  async function handleCreateAccount() {
    if (!form.account_name.trim()) {
      setError("Account name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await createAdminMarketingAccount({
        platform: form.platform,
        account_name: form.account_name.trim(),
        external_account_id: form.external_account_id.trim(),
        notes: form.notes.trim(),
      });
      setForm(EMPTY_FORM);
      setMessage("Marketing account added to the available pool.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create marketing account");
    } finally {
      setSaving(false);
    }
  }

  async function handleAllot(accountId: string) {
    const ownerId = selectedOwners[accountId];
    if (!ownerId) {
      setError("Select a subscription owner before allotting an account.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await allotAdminMarketingAccount(accountId, ownerId, notesByAccount[accountId] || "");
      setMessage("Marketing portal account allotted successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not allot the marketing account");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(accountId: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await revokeAdminMarketingAccount(accountId, notesByAccount[accountId] || "");
      setMessage("Marketing portal account returned to the available pool.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the marketing account");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="marketingAdminStack">
      <div className="statsGrid">
        <div className="statCard">
          <div className="statLabel">Marketing accounts</div>
          <div className="statValue">{accounts.length}</div>
          <div className="statHint">Total Meta, Google, and channel accounts available to assign.</div>
        </div>
        <div className="statCard">
          <div className="statLabel">Available</div>
          <div className="statValue">{availableCount}</div>
          <div className="statHint">Ready to allot to eligible Enterprise or Builder subscribers.</div>
        </div>
        <div className="statCard">
          <div className="statLabel">Allotted</div>
          <div className="statValue">{allottedCount}</div>
          <div className="statHint">Currently reserved by active subscriber organizations.</div>
        </div>
        <div className="statCard">
          <div className="statLabel">Request queue</div>
          <div className="statValue">{requests.length}</div>
          <div className="statHint">Submitted marketing requests visible to admin right now.</div>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {message ? <div className="alert ok">{message}</div> : null}

      <section className="card">
        <div className="sectionHeader">
          <div>
            <div className="cardTitle">Add marketing platform account</div>
            <div className="muted">Create a reusable account slot before allotting it inside the marketing portal.</div>
          </div>
        </div>
        <div className="grid2">
          <label>
            Platform
            <select value={form.platform} onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))}>
              <option value="meta">Meta Ads</option>
              <option value="google">Google Ads</option>
              <option value="hotstar">Hotstar / Disney+</option>
              <option value="youtube">YouTube</option>
            </select>
          </label>
          <label>
            Account name
            <input value={form.account_name} onChange={(event) => setForm((current) => ({ ...current, account_name: event.target.value }))} placeholder="Northstone Meta Pool A" />
          </label>
          <label>
            External account ID
            <input value={form.external_account_id} onChange={(event) => setForm((current) => ({ ...current, external_account_id: event.target.value }))} placeholder="Optional provider account ID" />
          </label>
          <label>
            Notes
            <input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Budget guardrails, channel notes, agency owner" />
          </label>
        </div>
        <div className="row right">
          <button className="btn" type="button" onClick={() => void handleCreateAccount()} disabled={saving}>
            {saving ? "Saving..." : "Add account"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <div className="cardTitle">Assign marketing portal accounts</div>
            <div className="muted">This is the admin allotment layer for the marketing portal. Only eligible plans should receive an account.</div>
          </div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Account</th>
                <th>Status</th>
                <th>Current holder</th>
                <th>Assign to</th>
                <th>Notes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="muted">Loading marketing account pool...</td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">No marketing accounts in the pool yet.</td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.platform}</td>
                    <td>
                      <div className="tdTitle">{account.account_name}</div>
                      <div className="muted small">{account.external_account_id || "No external ID saved"}</div>
                    </td>
                    <td>
                      <span className={`statusPill ${account.status === "available" ? "active" : "expiringsoon"}`}>{account.status}</span>
                    </td>
                    <td>
                      {account.allotted_to_owner_email ? (
                        <>
                          <div>{account.allotted_to_owner_email}</div>
                          <div className="muted small">{account.allotted_to_company || account.allotted_to_owner_name || "-"}</div>
                        </>
                      ) : (
                        <span className="muted">Available pool</span>
                      )}
                    </td>
                    <td>
                      <select
                        value={selectedOwners[account.id] || ""}
                        onChange={(event) => setSelectedOwners((current) => ({ ...current, [account.id]: event.target.value }))}
                      >
                        <option value="">Select owner</option>
                        {owners.map((owner) => (
                          <option key={owner.id} value={owner.id}>
                            {owner.email} · {owner.plan}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={notesByAccount[account.id] || ""}
                        onChange={(event) => setNotesByAccount((current) => ({ ...current, [account.id]: event.target.value }))}
                        placeholder="Audit note"
                      />
                    </td>
                    <td>
                      <div className="actionCell">
                        <button
                          className="btn"
                          type="button"
                          disabled={saving || !selectedOwners[account.id] || account.status === "allotted"}
                          onClick={() => void handleAllot(account.id)}
                        >
                          Allot
                        </button>
                        <button
                          className="btn ghost"
                          type="button"
                          disabled={saving || account.status !== "allotted"}
                          onClick={() => void handleRevoke(account.id)}
                        >
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <div className="cardTitle">Marketing request queue</div>
            <div className="muted">Admin visibility into submitted marketing work currently moving through the portal.</div>
          </div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Owner</th>
                <th>Project</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Monthly spend</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">No marketing requests have been submitted yet.</td>
                </tr>
              ) : (
                requests.slice(0, 12).map((row) => (
                  <tr key={row.id}>
                    <td className="tdTitle">{row.request_code}</td>
                    <td>
                      <div>{row.owner_name || "-"}</div>
                      <div className="muted small">{row.company || row.city || "-"}</div>
                    </td>
                    <td>{row.project_name || "-"}</td>
                    <td>{row.channel}</td>
                    <td>{row.status.replace(/_/g, " ")}</td>
                    <td>₹{Math.round(row.monthly_spend || 0).toLocaleString("en-IN")}</td>
                    <td>{fmtDate(row.updated_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <div className="cardTitle">Allotment audit trail</div>
            <div className="muted">Every assign/revoke action for the marketing portal account pool.</div>
          </div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Account</th>
                <th>Owner</th>
                <th>Plan</th>
                <th>Addon</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">No allotment history recorded yet.</td>
                </tr>
              ) : (
                audit.slice(0, 20).map((row) => (
                  <tr key={row.id}>
                    <td>{fmtDate(row.revoked_at || row.created_at)}</td>
                    <td>{row.action}</td>
                    <td>{row.account_name || row.platform}</td>
                    <td>{row.owner_email || row.owner_name || "-"}</td>
                    <td>{row.subscription_plan || "-"}</td>
                    <td>{row.addon_type || "-"}</td>
                    <td>{row.notes || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
