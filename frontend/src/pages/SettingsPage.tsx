import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

type MeResponse = {
  is_admin: boolean;
  ai_enabled?: boolean;
  ai_model?: string;
  ai_scope?: string;
  enterprise_company_name?: string;
};

type LlmTestResponse = { ok: boolean; output: string };

type RuntimeConfig = {
  env_file_path: string;
  frontend_origin: string;
  openrouter_base_url: string;
  admin_email: string;
  jwt_secret_configured: boolean;
  admin_password_mode: string;
  pbkdf2_rounds: number;
  data_encryption_key_configured: boolean;
  login_max_attempts: number;
  login_lockout_minutes: number;
  jwt_exp_days: number;
};

function scopeLabel(scope: string | undefined, companyName: string | undefined) {
  if (scope === "inherited_enterprise") return companyName ? `Inherited from ${companyName}` : "Inherited from enterprise owner";
  if (scope === "direct") return "Assigned directly by admin";
  if (scope === "admin") return "Managed in Admin";
  return "Not allocated yet";
}

export default function SettingsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState({
    frontend_origin: "",
    openrouter_base_url: "",
    admin_email: "",
    jwt_secret: "",
    admin_password: "",
    data_encryption_key: "",
    pbkdf2_rounds: 120000,
    login_max_attempts: 5,
    login_lockout_minutes: 15,
    jwt_exp_days: 30,
    store_admin_password_as_hash: true
  });

  async function load() {
    try {
      const meResp = await api<MeResponse>("/auth/me");
      setMe(meResp);
      if (meResp.is_admin) {
        const runtime = await api<RuntimeConfig>("/admin/runtime-config");
        setRuntimeConfig(runtime);
        setConfigForm((prev) => ({
          ...prev,
          frontend_origin: runtime.frontend_origin || "",
          openrouter_base_url: runtime.openrouter_base_url || "",
          admin_email: runtime.admin_email || "",
          pbkdf2_rounds: runtime.pbkdf2_rounds || 120000,
          login_max_attempts: runtime.login_max_attempts || 5,
          login_lockout_minutes: runtime.login_lockout_minutes || 15,
          jwt_exp_days: runtime.jwt_exp_days || 30
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Settings</div>
          <div className="muted">Access and system settings.</div>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <section className="card">
        <div className="cardTitle">AI access</div>
        <div className="mini">
          <div>
            <b>Status:</b> {me?.ai_enabled ? "Active" : me?.is_admin ? "Admin-managed" : "Waiting for admin allocation"}
          </div>
          <div>
            <b>Source:</b> {scopeLabel(me?.ai_scope, me?.enterprise_company_name)}
          </div>
          <div>
            <b>Model:</b> {me?.ai_model || "Not assigned"}
          </div>
        </div>
        <div className="muted small">
          Regular users and enterprise team members cannot add personal API keys here anymore. Admin assigns AI access to solo users directly and to enterprise teams through the enterprise owner account.
        </div>

        {msg ? <div className="alert ok">{msg}</div> : null}

        <div className="row">
          <button
            className="btn ghost"
            type="button"
            disabled={busy || !me || !me.ai_enabled}
            onClick={async () => {
              setBusy(true);
              setError(null);
              setMsg(null);
              try {
                const resp = await api<LlmTestResponse>("/ai/llm/test", {
                  method: "POST",
                  body: JSON.stringify({ provider: "openrouter" })
                });
                setMsg(`AI access verified: ${resp.output}`);
              } catch (e) {
                setError(e instanceof Error ? e.message : "AI test failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Testing..." : "Test assigned AI access"}
          </button>
          {me?.is_admin ? (
            <Link className="btn ghost" to="/admin">
              Open full Admin panel
            </Link>
          ) : null}
        </div>
      </section>

      {me?.is_admin && runtimeConfig ? (
        <section className="card premiumPanel">
          <div className="cardTitle">Admin controls</div>
          <div className="muted small">
            You can edit encryption, admin credentials, and session controls here directly. Active env file: <b>{runtimeConfig.env_file_path}</b>
          </div>
          <div className="statsGrid">
            <div className="statCard">
              <div className="statLabel">Encryption</div>
              <div className="statValue">{runtimeConfig.data_encryption_key_configured ? "Enabled" : "Missing"}</div>
              <div className="statHint">Required before storing AI keys securely.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Admin password</div>
              <div className="statValue">{runtimeConfig.admin_password_mode}</div>
              <div className="statHint">Hashed mode is safer for production.</div>
            </div>
            <div className="statCard">
              <div className="statLabel">JWT secret</div>
              <div className="statValue">{runtimeConfig.jwt_secret_configured ? "Configured" : "Missing"}</div>
              <div className="statHint">Controls token signing security.</div>
            </div>
          </div>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setConfigBusy(true);
              setConfigMsg(null);
              try {
                const payload = {
                  frontend_origin: configForm.frontend_origin,
                  openrouter_base_url: configForm.openrouter_base_url,
                  admin_email: configForm.admin_email,
                  pbkdf2_rounds: configForm.pbkdf2_rounds,
                  login_max_attempts: configForm.login_max_attempts,
                  login_lockout_minutes: configForm.login_lockout_minutes,
                  jwt_exp_days: configForm.jwt_exp_days,
                  store_admin_password_as_hash: configForm.store_admin_password_as_hash,
                  ...(configForm.jwt_secret.trim() ? { jwt_secret: configForm.jwt_secret } : {}),
                  ...(configForm.admin_password.trim() ? { admin_password: configForm.admin_password } : {}),
                  ...(configForm.data_encryption_key.trim() ? { data_encryption_key: configForm.data_encryption_key } : {})
                };
                const updated = await api<RuntimeConfig>("/admin/runtime-config", {
                  method: "POST",
                  body: JSON.stringify(payload)
                });
                setRuntimeConfig(updated);
                setConfigForm((prev) => ({ ...prev, jwt_secret: "", admin_password: "", data_encryption_key: "" }));
                setConfigMsg("Admin configuration updated.");
                await load();
              } catch (e) {
                setConfigMsg(e instanceof Error ? e.message : "Could not update admin configuration");
              } finally {
                setConfigBusy(false);
              }
            }}
          >
            <div className="grid2">
              <label>
                Admin email
                <input value={configForm.admin_email} onChange={(e) => setConfigForm((prev) => ({ ...prev, admin_email: e.target.value }))} />
              </label>
              <label>
                Frontend origin
                <input value={configForm.frontend_origin} onChange={(e) => setConfigForm((prev) => ({ ...prev, frontend_origin: e.target.value }))} />
              </label>
            </div>
            <div className="grid2">
              <label>
                OpenRouter base URL
                <input value={configForm.openrouter_base_url} onChange={(e) => setConfigForm((prev) => ({ ...prev, openrouter_base_url: e.target.value }))} />
              </label>
              <label>
                Data encryption key
                <input
                  type="password"
                  value={configForm.data_encryption_key}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, data_encryption_key: e.target.value }))}
                  placeholder={runtimeConfig.data_encryption_key_configured ? "Enter a new key only to rotate it" : "Paste generated Fernet key"}
                />
              </label>
            </div>
            <div className="grid2">
              <label>
                New JWT secret
                <input
                  type="password"
                  value={configForm.jwt_secret}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, jwt_secret: e.target.value }))}
                  placeholder="Leave blank to keep current secret"
                />
              </label>
              <label>
                New admin password
                <input
                  type="password"
                  value={configForm.admin_password}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, admin_password: e.target.value }))}
                  placeholder="Leave blank to keep current password"
                />
              </label>
            </div>
            <label>
              Password storage mode
              <select
                value={configForm.store_admin_password_as_hash ? "hashed" : "plain"}
                onChange={(e) => setConfigForm((prev) => ({ ...prev, store_admin_password_as_hash: e.target.value === "hashed" }))}
              >
                <option value="hashed">Store as hash</option>
                <option value="plain">Store as plain text</option>
              </select>
            </label>
            <div className="grid2">
              <label>
                PBKDF2 rounds
                <input type="number" min={60000} value={configForm.pbkdf2_rounds} onChange={(e) => setConfigForm((prev) => ({ ...prev, pbkdf2_rounds: Number(e.target.value) || 60000 }))} />
              </label>
              <label>
                JWT expiry days
                <input type="number" min={1} value={configForm.jwt_exp_days} onChange={(e) => setConfigForm((prev) => ({ ...prev, jwt_exp_days: Number(e.target.value) || 30 }))} />
              </label>
            </div>
            <div className="grid2">
              <label>
                Login max attempts
                <input type="number" min={1} value={configForm.login_max_attempts} onChange={(e) => setConfigForm((prev) => ({ ...prev, login_max_attempts: Number(e.target.value) || 5 }))} />
              </label>
              <label>
                Lockout minutes
                <input type="number" min={1} value={configForm.login_lockout_minutes} onChange={(e) => setConfigForm((prev) => ({ ...prev, login_lockout_minutes: Number(e.target.value) || 15 }))} />
              </label>
            </div>
            {configMsg ? <div className="alert ok">{configMsg}</div> : null}
            <button className="btn" type="submit" disabled={configBusy}>
              {configBusy ? "Saving..." : "Save admin configuration"}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
