import { useEffect, useState } from "react";
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

type ForgotPasswordResponse = {
  ok: boolean;
  message: string;
  preview_reset_url?: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function installSupportMessage() {
  const ua = navigator.userAgent || "";
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isWindows = /Windows/i.test(ua);

  if (isIos) {
    return "On iPhone or iPad, open this in Safari and use Share -> Add to Home Screen.";
  }
  if (isAndroid) {
    return "On Android, use Add to Home Screen / Install App from your browser menu if the install prompt does not appear.";
  }
  if (isWindows) {
    return "On Windows, Chrome or Edge can install Northstone from the browser menu as a desktop app.";
  }
  return "Use your browser install menu to add Northstone like an app on supported devices.";
}

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
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [previewResetUrl, setPreviewResetUrl] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(() => Boolean(new URLSearchParams(window.location.search).get("reset_token")));
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get("reset_token") ?? "");
  const [resetPassword, setResetPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  const canSubmit = backend.status === "up" && email.trim().includes("@") && password.length >= 8 && !busy;

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  return (
    <div className="loginWrap">
      <div className="loginCard">
        <div className="brand">
          <div className="logo">
            <img src="/northstone-mark.svg" alt="Northstone logo" className="logoMark" />
          </div>
          <div>
            <div className="brandTitle">Northstone</div>
            <div className="brandSub">Secure sign-in for your pipeline, reporting, and team workflows.</div>
          </div>
        </div>
        <div className="muted small" style={{ marginTop: 10 }}>
          Want to explore first? <a href="/" style={{ color: "inherit", textDecoration: "underline" }}>Open the CRM preview</a>.
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="cardTitle">Download / Install Northstone</div>
          <div className="muted small">
            Northstone can be installed like an app on <b>Windows</b>, <b>Android</b>, and <b>iPhone / iPad</b>. Use the install button when supported, or your browser menu if the prompt does not appear.
          </div>
          {installMsg ? <div className="alert ok" style={{ marginTop: 12 }}>{installMsg}</div> : null}
          <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
            <button
              className="btn ghost"
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
                    setInstallMsg(choice.outcome === "accepted" ? "Northstone install started." : installSupportMessage());
                  } else {
                    setInstallMsg(installSupportMessage());
                  }
                } finally {
                  setInstallBusy(false);
                }
              }}
            >
              {installBusy ? "Opening..." : "Download / Install CRM"}
            </button>
            <a className="btn ghost" href="/" style={{ textDecoration: "none" }}>
              Open website preview
            </a>
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
          {resetToken ? (
            <button className="linkBtn" type="button" onClick={() => setResetOpen(true)}>
              Open reset password form
            </button>
          ) : null}
        </form>
      </div>

      <Modal title="Forgot password" open={forgotOpen} onClose={() => setForgotOpen(false)}>
        <div className="form">
          <div className="muted">Enter your login email and we will start the password reset process for that account.</div>
          <label>
            Login email
            <input value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </label>
          {forgotMsg ? <div className="alert ok">{forgotMsg}</div> : null}
          {previewResetUrl ? (
            <div className="alert ok">
              Test reset link:
              <div className="muted small" style={{ marginTop: 8, wordBreak: "break-all" }}>{previewResetUrl}</div>
            </div>
          ) : null}
          <div className="row right">
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setForgotOpen(false);
                setResetOpen(true);
              }}
            >
              I already have a reset link
            </button>
            <button
              className="btn"
              type="button"
              disabled={forgotBusy || !forgotEmail.trim().includes("@")}
              onClick={async () => {
                setForgotBusy(true);
                setForgotMsg(null);
                setPreviewResetUrl(null);
                try {
                  const resp = await api<ForgotPasswordResponse>("/auth/forgot-password", {
                    method: "POST",
                    body: JSON.stringify({ email: forgotEmail })
                  });
                  setForgotMsg(resp.message);
                  setPreviewResetUrl(resp.preview_reset_url ?? null);
                } catch (err) {
                  setForgotMsg(err instanceof Error ? err.message : "Could not start password reset");
                } finally {
                  setForgotBusy(false);
                }
              }}
            >
              {forgotBusy ? "Please wait..." : "Request reset"}
            </button>
            <button className="btn" type="button" onClick={() => setForgotOpen(false)}>
              OK
            </button>
          </div>
        </div>
      </Modal>

      <Modal title="Reset password" open={resetOpen} onClose={() => setResetOpen(false)}>
        <div className="form">
          <div className="muted">Paste the reset token from your reset link, then choose a new password.</div>
          <label>
            Reset token
            <input value={resetToken} onChange={(e) => setResetToken(e.target.value.trim())} placeholder="Paste reset token" />
          </label>
          <label>
            New password
            <input
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              type="password"
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
            />
          </label>
          {resetMsg ? <div className="alert ok">{resetMsg}</div> : null}
          <div className="row right">
            <button
              className="btn"
              type="button"
              disabled={resetBusy || !resetToken.trim() || resetPassword.length < 8}
              onClick={async () => {
                setResetBusy(true);
                setResetMsg(null);
                try {
                  const resp = await api<{ ok: boolean; message: string }>("/auth/reset-password", {
                    method: "POST",
                    body: JSON.stringify({ token: resetToken, new_password: resetPassword })
                  });
                  setResetMsg(resp.message);
                  setPassword("");
                  setResetPassword("");
                  setResetOpen(false);
                  const url = new URL(window.location.href);
                  url.searchParams.delete("reset_token");
                  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
                  setResetToken("");
                  setMode("login");
                } catch (err) {
                  setResetMsg(err instanceof Error ? err.message : "Could not reset password");
                } finally {
                  setResetBusy(false);
                }
              }}
            >
              {resetBusy ? "Saving..." : "Reset password"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
