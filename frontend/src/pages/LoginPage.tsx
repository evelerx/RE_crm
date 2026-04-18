import { useState } from "react";
import { api } from "../api/client";
import { setSession } from "../auth";
import Modal from "../components/Modal";
import { useBackendStatus } from "../hooks/useBackendStatus";

type LoginResponse = {
  email: string;
  token: string;
  is_admin?: boolean;
  plan?: string;
  enterprise_owner_id?: string | null;
};

export default function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const backend = useBackendStatus();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  const canSubmit = backend.status === "up" && email.trim().includes("@") && password.length >= 8 && !busy;

  return (
    <div className="loginWrap">
      <div className="loginCard">
        <div className="brand">
          <div className="logo" />
          <div>
            <div className="brandTitle">Deal Intelligence OS</div>
            <div className="brandSub">Secure sign-in for your pipeline, reporting, and team workflows.</div>
          </div>
        </div>

        <div className="row">
          <button className={mode === "login" ? "btn" : "btn ghost"} onClick={() => setMode("login")} type="button">
            Login
          </button>
          <button className={mode === "signup" ? "btn" : "btn ghost"} onClick={() => setMode("signup")} type="button">
            Sign up
          </button>
        </div>

        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canSubmit) return;
            setBusy(true);
            setError(null);
            try {
              const path = mode === "signup" ? "/auth/signup" : "/auth/login";
              const resp = await api<LoginResponse>(path, {
                method: "POST",
                body: JSON.stringify({ email, password })
              });
              setSession(resp.email, resp.token);
              onLoggedIn();
              if (resp.is_admin) {
                window.location.href = "/admin";
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Login failed";
              if (mode === "signup" && msg.toLowerCase().includes("already exists")) {
                setError("This email is already registered. Please switch to Login.");
                setMode("login");
              } else if (mode === "login" && msg.toLowerCase().includes("old version")) {
                setError("Your password needs a reset. Open Forgot password and contact the admin.");
              } else if (msg.toLowerCase().includes("blacklisted")) {
                setError(msg);
              } else if (mode === "login" && msg.toLowerCase().includes("invalid email or password")) {
                setError("Invalid email or password. If you are new here, create an account first.");
              } else {
                setError(msg);
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setHint(null);
              }}
              onBlur={async () => {
                const em = email.trim();
                if (!em.includes("@")) return;
                setChecking(true);
                try {
                  const resp = await api<{ exists: boolean; has_password: boolean }>(`/auth/exists?email=${encodeURIComponent(em)}`);
                  if (resp.exists) {
                    setHint("This email already exists. Switch to Login.");
                    setMode("login");
                  } else {
                    setHint(mode === "login" ? "No account found yet. Switch to Sign up." : null);
                  }
                } catch {
                  // Ignore helper lookup failures.
                } finally {
                  setChecking(false);
                }
              }}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label>
            Password (minimum 8 characters)
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Enter your password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </label>
          {backend.status !== "up" ? (
            <div className="alert">
              {backend.status === "checking" ? "Connecting to server..." : `Server not reachable at ${backend.apiBaseUrl}.`}
              <div className="muted small">
                If you are on mobile, make sure the backend is running on the host machine and port 8000 is allowed through Windows Firewall.
              </div>
            </div>
          ) : null}
          {checking ? <div className="muted small">Checking email...</div> : null}
          {hint ? <div className="muted small">{hint}</div> : null}
          {error ? <div className="alert">{error}</div> : null}
          {busy ? <div className="muted small">If this takes longer than 10 seconds, the backend may still be starting up.</div> : null}
          <button className="btn" type="submit" disabled={!canSubmit}>
            {busy ? "Please wait..." : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          <div className="muted small">
            Your data stays tied to this email on the current system, so signing back in restores your workspace.
          </div>
          <button className="linkBtn" type="button" onClick={() => setForgotOpen(true)}>
            Forgot password?
          </button>
        </form>
      </div>

      <Modal title="Forgot password" open={forgotOpen} onClose={() => setForgotOpen(false)}>
        <div className="form">
          <div className="muted">Password recovery is currently handled by the admin team.</div>
          <div className="muted">
            Share your login email with the admin, get a reset completed, then return here and sign in with the new password.
          </div>
          <div className="row right">
            <button className="btn" type="button" onClick={() => setForgotOpen(false)}>
              OK
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
