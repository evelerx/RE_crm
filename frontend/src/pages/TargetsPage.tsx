// MODIFIED: RBAC feature parity — Replaced static target tracker scaffold with live target CRUD so "set_targets" points to a working page.
import { useEffect, useMemo, useState } from "react";

import { createTarget, deleteTarget, listTargets, updateTarget } from "../api/client";
import type { TargetGoal } from "../api/types";

const METRIC_OPTIONS = [
  { value: "deals_closed", label: "Deals closed" },
  { value: "deals_created", label: "Deals created" },
  { value: "contacts_added", label: "Contacts added" },
  { value: "site_visits", label: "Site visits" },
  { value: "follow_ups", label: "Follow-ups" },
  { value: "revenue_inr", label: "Revenue (₹)" },
];

function metricLabel(metric: string) {
  return METRIC_OPTIONS.find((item) => item.value === metric)?.label || metric.replace(/_/g, " ");
}

export default function TargetsPage() {
  const [rows, setRows] = useState<TargetGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    subject_label: "",
    metric: "deals_closed",
    target_value: "10",
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await listTargets());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load targets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const totalTargets = useMemo(() => rows.reduce((sum, row) => sum + row.target_value, 0), [rows]);
  const totalActual = useMemo(() => rows.reduce((sum, row) => sum + row.actual_value, 0), [rows]);

  async function handleCreate() {
    const targetValue = Number(form.target_value);
    if (!Number.isFinite(targetValue) || targetValue < 0) {
      setError("Target value must be 0 or more.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createTarget({
        subject_label: form.subject_label.trim(),
        metric: form.metric,
        target_value: Math.round(targetValue),
      });
      setRows((current) => [created, ...current]);
      setForm({ subject_label: "", metric: "deals_closed", target_value: "10" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create target");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Targets</div>
          <div className="muted">Monitor target vs actual progress for owners, teams, and performance metrics.</div>
        </div>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="statsGrid">
        <div className="statCard">
          <div className="statLabel">Target rows</div>
          <div className="statValue">{rows.length}</div>
          <div className="statHint">Live targets currently tracked in this scope.</div>
        </div>
        <div className="statCard">
          <div className="statLabel">Total target</div>
          <div className="statValue">{totalTargets.toLocaleString("en-IN")}</div>
          <div className="statHint">Combined target value across all metrics.</div>
        </div>
        <div className="statCard">
          <div className="statLabel">Actual progress</div>
          <div className="statValue">{totalActual.toLocaleString("en-IN")}</div>
          <div className="statHint">Live numbers calculated from your CRM records.</div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="cardTitle">Add target</div>
        <div className="grid3">
          <label>
            Owner / team label
            <input
              value={form.subject_label}
              onChange={(event) => setForm((current) => ({ ...current, subject_label: event.target.value }))}
              placeholder="West Zone team, Builder desk, Solo owner"
            />
          </label>
          <label>
            Metric
            <select value={form.metric} onChange={(event) => setForm((current) => ({ ...current, metric: event.target.value }))}>
              {METRIC_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target value
            <input
              value={form.target_value}
              onChange={(event) => setForm((current) => ({ ...current, target_value: event.target.value }))}
              inputMode="numeric"
              placeholder="10"
            />
          </label>
        </div>
        <div className="row right">
          <button className="btn" type="button" onClick={() => void handleCreate()} disabled={busy}>
            {busy ? "Saving..." : "Create target"}
          </button>
        </div>
      </div>

      <div className="card card-pad">
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Owner</th>
                <th>Role</th>
                <th>Metric</th>
                <th>Actual</th>
                <th>Target</th>
                <th>Progress</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, rowIndex) => (
                    <tr key={`loading-${rowIndex}`}>
                      {Array.from({ length: 7 }).map((__, cellIndex) => (
                        <td key={cellIndex}>
                          <div className="skeletonBar" style={{ width: `${45 + ((rowIndex + cellIndex) % 4) * 10}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row) => {
                    const percent = row.target_value <= 0 ? 0 : Math.min(100, Math.round((row.actual_value / row.target_value) * 100));
                    return (
                      <tr key={row.id}>
                        <td className="tdTitle">{row.subject_name || row.subject_label || "General target"}</td>
                        <td>{row.subject_role || "-"}</td>
                        <td>{metricLabel(row.metric)}</td>
                        <td>{row.actual_value.toLocaleString("en-IN")}</td>
                        <td>{row.target_value.toLocaleString("en-IN")}</td>
                        <td>
                          <div className="targetProgressBar">
                            <div className="targetProgressFill" style={{ width: `${percent}%` }} />
                          </div>
                        </td>
                        <td>
                          <div className="row">
                            <button
                              className="btn ghost compact"
                              type="button"
                              onClick={async () => {
                                const nextValue = window.prompt("Update target value", String(row.target_value));
                                if (nextValue == null) return;
                                const parsed = Number(nextValue);
                                if (!Number.isFinite(parsed) || parsed < 0) {
                                  setError("Target value must be 0 or more.");
                                  return;
                                }
                                try {
                                  const updated = await updateTarget(row.id, { target_value: Math.round(parsed) });
                                  setRows((current) => current.map((item) => (item.id === row.id ? updated : item)));
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : "Could not update target");
                                }
                              }}
                            >
                              Edit
                            </button>
                            <button
                              className="btn ghost compact"
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(`Delete target "${row.subject_name || row.subject_label || row.metric}"?`)) return;
                                try {
                                  await deleteTarget(row.id);
                                  setRows((current) => current.filter((item) => item.id !== row.id));
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : "Could not delete target");
                                }
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No targets have been added yet. Create your first live target above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
