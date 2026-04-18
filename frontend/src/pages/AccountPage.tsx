import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Profile } from "../api/types";

function validateGstin(gstin: string): string | null {
  const v = gstin.trim().toUpperCase();
  if (!v) return null;
  const re = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  if (!re.test(v)) return "GSTIN format looks invalid.";
  return null;
}

function validateRera(rera: string): string | null {
  const v = rera.trim().toUpperCase();
  if (!v) return null;
  if (v.length < 8) return "RERA ID looks too short.";
  if (!/^[A-Z0-9/-]+$/.test(v)) return "RERA ID contains invalid characters.";
  return null;
}

type MeState = {
  ai_enabled?: boolean;
  ai_scope?: string;
  ai_model?: string;
  profile_completion?: { completed: number; total: number; ready: boolean };
  enterprise_company_name?: string;
};

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [me, setMe] = useState<MeState | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && !busy;
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
  }, []);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Account</div>
          <div className="muted">Profile and access details.</div>
        </div>
      </div>

      {profile && !profile.rera_id.trim() ? (
        <div className="alert">
          RERA ID is required before you can use the full website. Save it below to unlock the rest of the platform.
        </div>
      ) : null}

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
                <input value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value || null })} />
              </label>
              <label>
                WhatsApp
                <input value={profile.whatsapp ?? ""} onChange={(e) => setProfile({ ...profile, whatsapp: e.target.value || null })} />
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
