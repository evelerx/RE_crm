import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { agencyLogin } from "../api/client";
import { setAgencySession } from "../auth";

export default function AgencyLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await agencyLogin(email.trim(), password);
      setAgencySession(res.agency_token);
      navigate("/agency");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loginCard" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <form className="loginCard" onSubmit={handleSubmit} style={{ maxWidth: 400, width: "100%", padding: 32, borderRadius: 20, background: "white", boxShadow: "0 24px 80px rgba(16,24,40,.12)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img src="/northstone-logo-icon.png" alt="Northstone" style={{ width: 48, height: 48, marginBottom: 12 }} />
          <div style={{ fontWeight: 800, fontSize: 22 }}>Marketing Portal</div>
          <div className="muted small">Sign in with your agency credentials</div>
        </div>
        {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="manager@agency.com" autoComplete="email" required />
        </label>
        <label style={{ marginTop: 12 }}>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim() || !password} style={{ width: "100%", marginTop: 20 }}>
          {busy ? "Signing in..." : "Sign in to Marketing Portal"}
        </button>
        <div className="muted small" style={{ textAlign: "center", marginTop: 16 }}>
          This portal is for Northstone Marketing agency staff only.<br />
          CRM users: <a href="/login" className="shellNavItem" style={{ textDecoration: "underline" }}>return to CRM login</a>
        </div>
      </form>
    </div>
  );
}
