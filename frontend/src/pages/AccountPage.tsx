import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Profile } from "../api/types";

function validatePhone(phone: string): string | null {
  const v = phone.trim().replace(/\s+/g, "");
  if (!v) return null;
  const digits = v.startsWith("+91") ? v.slice(3) : v.startsWith("91") && v.length === 12 ? v.slice(2) : v;
  if (!/^[6-9]\d{9}$/.test(digits)) return "Enter a valid 10-digit Indian mobile number (starts with 6–9).";
  return null;
}

function validateGstin(gstin: string): string | null {
  const v = gstin.trim().toUpperCase();
  if (!v) return null;
  if (v.length !== 15) return "GSTIN must be exactly 15 characters.";
  const re = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  if (!re.test(v)) return "GSTIN format invalid — expected: 2-digit state · 10-char PAN · entity · Z · check digit.";
  const stateCode = parseInt(v.slice(0, 2), 10);
  if (stateCode < 1 || stateCode > 38) return "GSTIN state code looks invalid.";
  return null;
}

function validateRera(rera: string): string | null {
  const v = rera.trim().toUpperCase();
  if (!v) return null;
  if (v.length < 8) return "RERA ID looks too short.";
  if (!/^[A-Z0-9/-]+$/.test(v)) return "RERA ID contains invalid characters (only A-Z, 0-9, / and - allowed).";
  // Maharashtra (MahaRERA): P/A/L/O + 51800 + 6 digits (projects, agents, layout, organizations)
  if (/^[PALO]51800\d{6}$/.test(v)) return null;
  // Haryana RERA formats
  if (/^(RC\/REP\/HARERA|RERA\/GGN|RERA\/GURUGRAM|RERA\/FARIDABAD|RERA\/SONIPAT|HARERA)/i.test(v)) return null;
  // Generic slash-separated state RERA format
  if (/^[A-Z]{2,6}\/[A-Z0-9]{1,8}\/[A-Z0-9-/]{4,}$/i.test(v)) return null;
  return "RERA ID format not recognised. MahaRERA: P51800XXXXXX · Haryana: RC/REP/HARERA/... or RERA/GGN/...";
}

type MeState = {
  email?: string;
  plan?: string;
  is_admin?: boolean;
  ai_enabled?: boolean;
  ai_scope?: string;
  ai_model?: string;
  profile_completion?: { completed: number; total: number; ready: boolean };
  enterprise_company_name?: string;
  enterprise_member_role?: string;
  subscription_plan?: string;
  subscription_cycle?: string;
  subscription_seats?: number;
  can_install_app?: boolean;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type BillingSummary = {
  product_plan: string;
  billing_cycle: string;
  seats: number;
  amount_inr: number;
  started_at: string | null;
  expires_at: string | null;
  is_owner: boolean;
};

type PaymentRow = {
  id: string;
  kind: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  status: string;
  product_plan: string;
  billing_cycle: string;
  seats: number;
  amount_inr: number;
  currency: string;
  description: string;
  created_at: string;
};

type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: { error?: { description?: string } }) => void) => void;
    };
  }
}

function ensureRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[data-razorpay-checkout="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Razorpay checkout failed to load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Razorpay checkout failed to load."));
    document.body.appendChild(script);
  });
}

function formatBillingDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatInr(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
}

function scopeLabel(scope: string | undefined, companyName: string | undefined) {
  if (scope === "inherited_enterprise") return companyName ? `Inherited from ${companyName}` : "Inherited from enterprise owner";
  if (scope === "direct") return "Assigned directly by admin";
  if (scope === "admin") return "Managed in Admin";
  return "Not allocated yet";
}

function formatPlanLabel(me: MeState | null) {
  return (me?.subscription_plan || me?.plan || "free_trial").replace(/_/g, " ");
}

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [me, setMe] = useState<MeState | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [renewBusy, setRenewBusy] = useState(false);
  const [renewMsg, setRenewMsg] = useState<string | null>(null);
  const [renewError, setRenewError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && !busy;
  const isSubscriptionOwner = Boolean(me?.can_install_app);
  const profileChecks = profile
    ? [
        { label: "RERA ID", done: Boolean(profile.rera_id.trim()) },
        { label: "Full name", done: Boolean(profile.full_name.trim()) },
        { label: "Phone", done: Boolean((profile.phone ?? "").trim()) },
        { label: "Company", done: Boolean(profile.company.trim()) },
        { label: "City", done: Boolean(profile.city.trim()) },
        { label: "Bio", done: Boolean(profile.bio.trim()) }
      ]
    : [];
  const completedChecks = profileChecks.filter((item) => item.done).length;

  useEffect(() => {
    (async () => {
      try {
        const [profileResp, meResp] = await Promise.all([api<Profile>("/profile"), api<MeState>("/auth/me")]);
        setProfile(profileResp);
        setMe(meResp);
      } catch {
        // Ignore initial read issues here; route-level auth already handles access.
      }
    })();
    (async () => {
      try {
        const [summary, paymentRows] = await Promise.all([
          api<BillingSummary>("/billing/summary"),
          api<PaymentRow[]>("/billing/payments"),
        ]);
        setBilling(summary);
        setPayments(paymentRows);
      } catch {
        // Billing is supplementary here; leave panel in its empty state on failure.
      }
    })();
  }, []);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  async function renewSubscription() {
    setRenewBusy(true);
    setRenewError(null);
    setRenewMsg(null);
    try {
      const order = await api<{ order_id: string; amount_paise: number; currency: string; key_id: string; amount_inr: number }>(
        "/billing/renew-order",
        { method: "POST" },
      );
      await ensureRazorpayScript();
      if (!window.Razorpay) throw new Error("Razorpay checkout is unavailable right now.");

      const rzp = new window.Razorpay({
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount_paise,
        currency: order.currency,
        name: "Northstone CRM",
        description: `${formatPlanLabel(me)} plan renewal`,
        prefill: { email: me?.email || "" },
        theme: { color: "#1f5de0" },
        modal: {
          ondismiss: () => {
            setRenewBusy(false);
            setRenewError("Renewal checkout was cancelled.");
          },
        },
        handler: (response: RazorpayCheckoutResponse) => {
          void (async () => {
            try {
              const result = await api<{ ok: boolean; expires_at: string | null; amount_inr: number }>("/billing/renew-verify", {
                method: "POST",
                body: JSON.stringify({
                  amount_inr: order.amount_inr,
                  payment_order_id: response.razorpay_order_id,
                  payment_id: response.razorpay_payment_id,
                  payment_signature: response.razorpay_signature,
                }),
              });
              setRenewMsg(`Renewed. New expiry: ${formatBillingDate(result.expires_at)}`);
              const [summary, paymentRows] = await Promise.all([
                api<BillingSummary>("/billing/summary"),
                api<PaymentRow[]>("/billing/payments"),
              ]);
              setBilling(summary);
              setPayments(paymentRows);
            } catch (e) {
              setRenewError(e instanceof Error ? e.message : "Payment received but renewal could not be confirmed. Contact support.");
            } finally {
              setRenewBusy(false);
            }
          })();
        },
      });
      rzp.on("payment.failed", (response) => {
        setRenewBusy(false);
        setRenewError(response?.error?.description || "Payment failed. Please try again.");
      });
      rzp.open();
    } catch (e) {
      setRenewBusy(false);
      setRenewError(e instanceof Error ? e.message : "Could not start renewal checkout.");
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">User Profile</div>
          <div className="muted">Your profile, account access, security, and app settings in one place.</div>
        </div>
      </div>

      {/* RERA mandatory banner disabled — optional for now */}

      {profile ? (
        <section className="card premiumPanel">
          <div className="cardTitle">Readiness Checklist</div>
          <div className="statsGrid">
            <div className="statCard">
              <div className="statLabel">Profile completion</div>
              <div className="statValue">
                {me?.profile_completion ? `${me.profile_completion.completed}/${me.profile_completion.total}` : `${completedChecks}/${profileChecks.length}`}
              </div>
              <div className="statHint">Complete the essentials so exports, trust cues, and onboarding workflows are fully enabled.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">AI access</div>
              <div className="statValue">{me?.ai_enabled ? "Live" : "Pending"}</div>
              <div className="statHint">
                {me?.ai_enabled
                  ? `${me.ai_model || "Assigned model"} managed through ${me.ai_scope || "admin controls"}.`
                  : "Advanced AI workflows will unlock after admin allocation."}
              </div>
            </div>
          </div>
          <div className="list">
            {profileChecks.map((item) => (
              <div key={item.label} className="listItem">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>{item.label}</div>
                  <div className={item.done ? "pill adminPill" : "pill"}>{item.done ? "Ready" : "Missing"}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card premiumPanel">
        <div className="cardTitle">Account Overview</div>
        <div className="statsGrid">
          <div className="statCard">
            <div className="statLabel">Email</div>
            <div className="statValue" style={{ fontSize: "1.15rem" }}>{me?.email || "Loading..."}</div>
            <div className="statHint">Primary sign-in identity for this CRM workspace.</div>
          </div>
          <div className="statCard">
            <div className="statLabel">Subscription</div>
            <div className="statValue" style={{ textTransform: "capitalize" }}>{formatPlanLabel(me)}</div>
            <div className="statHint">
              {(me?.subscription_cycle || "monthly").replace(/_/g, " ")} billing
              {me?.subscription_seats ? ` · ${me.subscription_seats} seats` : ""}
            </div>
          </div>
          <div className="statCard">
            <div className="statLabel">Workspace role</div>
            <div className="statValue" style={{ textTransform: "capitalize" }}>
              {me?.is_admin ? "Admin" : (me?.enterprise_member_role || "Owner").replace(/_/g, " ")}
            </div>
            <div className="statHint">
              {me?.enterprise_company_name ? `Attached to ${me.enterprise_company_name}.` : "Personal CRM workspace."}
            </div>
          </div>
          <div className="statCard">
            <div className="statLabel">AI access</div>
            <div className="statValue">{me?.ai_enabled ? "Active" : "Pending"}</div>
            <div className="statHint">{scopeLabel(me?.ai_scope, me?.enterprise_company_name)}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardTitle">User Settings</div>
        <div className="mini">
          <div>
            <b>AI status:</b> {me?.ai_enabled ? "Active" : me?.is_admin ? "Admin-managed" : "Waiting for allocation"}
          </div>
          <div>
            <b>AI model:</b> {me?.ai_model || "Not assigned"}
          </div>
          <div>
            <b>Source:</b> {scopeLabel(me?.ai_scope, me?.enterprise_company_name)}
          </div>
        </div>
        <div className="muted small">
          Profile information is editable below. System-level billing, admin policy, and secure environment controls stay managed separately.
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="btn ghost"
            type="button"
            disabled={!me?.ai_enabled || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              setMsg(null);
              try {
                const resp = await api<{ ok: boolean; output: string }>("/ai/llm/test", {
                  method: "POST",
                  body: JSON.stringify({ provider: "openrouter" }),
                });
                setMsg(`AI access verified: ${resp.output}`);
              } catch (e) {
                setError(e instanceof Error ? e.message : "AI test failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Testing..." : "Test AI access"}
          </button>
          {me?.is_admin ? (
            <Link className="btn ghost" to="/admin">
              Open Admin
            </Link>
          ) : null}
          <Link className="btn ghost" to="/settings">
            Open System Settings
          </Link>
        </div>
        {msg ? <div className="alert ok" style={{ marginTop: 16 }}>{msg}</div> : null}
        {error ? <div className="alert" style={{ marginTop: 16 }}>{error}</div> : null}
      </section>

      {isSubscriptionOwner ? (
        <section className="card premiumPanel" id="install-app">
          <div className="cardTitle">Install Northstone App</div>
          <div className="muted small">
            Subscription owners can install Northstone like an app while keeping live CRM, deals, and reports tied to the same workspace.
          </div>
          <div className="mini" style={{ marginTop: 14 }}>
            <div>
              <b>Plan:</b> {formatPlanLabel(me)}
            </div>
            <div>
              <b>Billing cycle:</b> {(me?.subscription_cycle || "monthly").replace(/_/g, " ")}
            </div>
            <div>
              <b>Seat allocation:</b> {me?.subscription_seats || 1}
            </div>
          </div>
          {installMsg ? <div className="alert ok" style={{ marginTop: 16 }}>{installMsg}</div> : null}
          <div className="row" style={{ marginTop: 16 }}>
            <button
              className="btn"
              type="button"
              disabled={installBusy}
              onClick={async () => {
                setInstallBusy(true);
                setInstallMsg(null);
                try {
                  if (installPrompt) {
                    await installPrompt.prompt();
                    const choice = await installPrompt.userChoice;
                    setInstallPrompt(null);
                    setInstallMsg(choice.outcome === "accepted" ? "Northstone install started." : "Install prompt dismissed. You can try again anytime.");
                  } else {
                    setInstallMsg("Install prompt is not available right now. On Chrome or Edge, use the browser menu and choose Install app / Add to desktop.");
                  }
                } finally {
                  setInstallBusy(false);
                }
              }}
            >
              {installBusy ? "Opening..." : "Install CRM app"}
            </button>
            <Link className="btn ghost" to="/">
              Open CRM
            </Link>
          </div>
        </section>
      ) : null}

      <section className="card premiumPanel" id="billing">
        <div className="cardTitle">Billing &amp; Payments</div>
        <div className="muted small">Your subscription status and payment history for this workspace.</div>

        <div className="statsGrid" style={{ marginTop: 14 }}>
          <div className="statCard">
            <div className="statLabel">Plan</div>
            <div className="statValue" style={{ textTransform: "capitalize" }}>{formatPlanLabel(me)}</div>
            <div className="statHint">
              {(billing?.billing_cycle || "monthly").replace(/_/g, " ")} billing · {billing?.seats || 1} seat{(billing?.seats || 1) === 1 ? "" : "s"}
            </div>
          </div>
          <div className="statCard">
            <div className="statLabel">Active since</div>
            <div className="statValue">{formatBillingDate(billing?.started_at)}</div>
          </div>
          <div className="statCard">
            <div className="statLabel">
              {billing?.expires_at && new Date(billing.expires_at) < new Date() ? "Expired on" : "Renews on"}
            </div>
            <div
              className="statValue"
              style={billing?.expires_at && new Date(billing.expires_at) < new Date() ? { color: "#e06464" } : undefined}
            >
              {formatBillingDate(billing?.expires_at)}
            </div>
          </div>
        </div>

        {billing?.is_owner && billing?.product_plan ? (
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" type="button" disabled={renewBusy} onClick={() => void renewSubscription()}>
              {renewBusy ? "Processing..." : "Renew now"}
            </button>
          </div>
        ) : null}
        {renewMsg ? <div className="alert ok" style={{ marginTop: 12 }}>{renewMsg}</div> : null}
        {renewError ? <div className="alert" style={{ marginTop: 12 }}>{renewError}</div> : null}

        <div className="cardTitle" style={{ marginTop: 20 }}>Payment history</div>
        <div className="list" style={{ marginTop: 8 }}>
          {payments.length === 0 ? (
            <div className="muted small">No payments recorded yet.</div>
          ) : (
            payments.map((payment) => (
              <div key={payment.id} className="listItem">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <b style={{ textTransform: "capitalize" }}>{payment.product_plan}</b> plan {payment.kind === "renewal" ? "renewal" : "signup"}
                    <div className="muted small">
                      {formatBillingDate(payment.created_at)} · {payment.razorpay_payment_id || "—"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div>
                      <b>{formatInr(payment.amount_inr)}</b>
                    </div>
                    <div className={payment.status === "captured" ? "pill adminPill" : "pill"}>{payment.status}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="card">
        <div className="cardTitle">Profile</div>
        <div className="muted">
          These details help with identity, onboarding quality, and selected client-facing exports.
          {me?.enterprise_company_name ? ` Enterprise tag: ${me.enterprise_company_name}.` : ""}
        </div>
        {profile ? (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setProfileBusy(true);
              setProfileMsg(null);
              setProfileErr(null);
              try {
                const saved = await api<Profile>("/profile", { method: "PUT", body: JSON.stringify(profile) });
                setProfile(saved);
                setProfileMsg("Profile saved.");
              } catch (err) {
                setProfileErr(err instanceof Error ? err.message : "Failed to save profile");
              } finally {
                setProfileBusy(false);
              }
            }}
          >
            <div className="grid2">
              <label>
                Full name
                <input value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} />
              </label>
              <label>
                Company / Brokerage
                <input value={profile.company} onChange={(e) => setProfile({ ...profile, company: e.target.value })} />
              </label>
            </div>
            <div className="grid2">
              <label>
                Phone
                <input value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value || null })} placeholder="+91 98765 43210" />
                {(() => { const w = validatePhone(profile.phone ?? ""); return w ? <div className="muted small">{w}</div> : null; })()}
              </label>
              <label>
                WhatsApp
                <input value={profile.whatsapp ?? ""} onChange={(e) => setProfile({ ...profile, whatsapp: e.target.value || null })} placeholder="+91 98765 43210" />
                {(() => { const w = validatePhone(profile.whatsapp ?? ""); return w ? <div className="muted small">{w}</div> : null; })()}
              </label>
            </div>
            <div className="grid2">
              <label>
                City
                <input value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} />
              </label>
              <label>
                Areas served (comma separated)
                <input value={profile.areas_served} onChange={(e) => setProfile({ ...profile, areas_served: e.target.value })} />
              </label>
            </div>
            <div className="grid2">
              <label>
                Specialization
                <input
                  value={profile.specialization}
                  onChange={(e) => setProfile({ ...profile, specialization: e.target.value })}
                  placeholder="Residential, commercial, plotted development"
                />
              </label>
              <label>
                Languages (comma separated)
                <input value={profile.languages} onChange={(e) => setProfile({ ...profile, languages: e.target.value })} placeholder="English, Hindi, Marathi" />
              </label>
            </div>
            <div className="grid2">
              <label>
                RERA ID
                <input value={profile.rera_id} onChange={(e) => setProfile({ ...profile, rera_id: e.target.value })} />
                {(() => {
                  const warn = validateRera(profile.rera_id);
                  return warn ? <div className="muted small">{warn}</div> : null;
                })()}
              </label>
              <label>
                GSTIN
                <input value={profile.gstin} onChange={(e) => setProfile({ ...profile, gstin: e.target.value })} />
                {(() => {
                  const warn = validateGstin(profile.gstin);
                  return warn ? <div className="muted small">{warn}</div> : null;
                })()}
              </label>
            </div>
            <label>
              Bio
              <textarea
                className="textarea"
                value={profile.bio}
                onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                placeholder="Summarize your experience, markets covered, and deal focus."
              />
            </label>
            {profileErr ? <div className="alert">{profileErr}</div> : null}
            {profileMsg ? <div className="alert ok">{profileMsg}</div> : null}
            <button className="btn" type="submit" disabled={profileBusy}>
              {profileBusy ? "Saving..." : "Save profile"}
            </button>
          </form>
        ) : (
          <div className="muted">Loading profile...</div>
        )}
      </section>

      <section className="card">
        <div className="cardTitle">Password Security</div>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canSubmit) return;
            setBusy(true);
            setError(null);
            setMsg(null);
            try {
              await api<{ changed: boolean }>("/auth/change-password", {
                method: "POST",
                body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
              });
              setCurrentPassword("");
              setNewPassword("");
              setMsg("Password updated.");
            } catch (err) {
              if (err instanceof ApiError) setError(err.message);
              else setError("Failed to change password");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Current password
            <input value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} type="password" autoComplete="current-password" />
          </label>
          <label>
            New password
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" autoComplete="new-password" />
          </label>
          {error ? <div className="alert">{error}</div> : null}
          {msg ? <div className="alert ok">{msg}</div> : null}
          <button className="btn" type="submit" disabled={!canSubmit}>
            {busy ? "Updating..." : "Update password"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="cardTitle">Password Recovery</div>
        <div className="muted">If you cannot access your account, contact the admin team for a reset.</div>
      </section>

      <section className="card premiumPanel">
        <div className="cardTitle">Recommended First-Week Workflow</div>
        <div className="list">
          <div className="listItem">Complete your profile and RERA first so the platform unlocks fully.</div>
          <div className="listItem">Wait for admin AI allocation if you plan to use advanced follow-up generation.</div>
          <div className="listItem">If you are under an enterprise, operational requests should flow through the enterprise owner for faster resolution.</div>
        </div>
      </section>
    </div>
  );
}
