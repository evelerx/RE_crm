import { useEffect, useMemo, useState } from "react";
import { listCalls } from "../api/client";
import type { CallRecord } from "../api/types";

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(value: number | null) {
  if (value == null) return "-";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export default function CallLogPage() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const rows = await listCalls(statusFilter ? { status: statusFilter, page_size: 50 } : { page_size: 50 });
      setCalls(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load call logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter]);

  const metrics = useMemo(() => {
    const completed = calls.filter((call) => call.status === "completed").length;
    const failed = calls.filter((call) => call.status === "failed").length;
    const totalDuration = calls.reduce((sum, call) => sum + (call.duration_seconds ?? 0), 0);
    return { completed, failed, totalDuration };
  }, [calls]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Calls</div>
          <div className="muted">Track Exotel calls, outcomes, duration, and recordings in one place.</div>
        </div>
        <button className="btn ghost" onClick={() => void load()} type="button">
          Refresh
        </button>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="statsGrid">
        <div className="statCard">
          <div className="statLabel">Recent calls</div>
          <div className="statValue">{calls.length}</div>
          <div className="statHint">Latest 50 call records for your CRM scope.</div>
        </div>
        <div className="statCard">
          <div className="statLabel">Completed</div>
          <div className="statValue">{metrics.completed}</div>
          <div className="statHint">Calls that finished and can contribute to activity reporting.</div>
        </div>
        <div className="statCard">
          <div className="statLabel">Failed</div>
          <div className="statValue">{metrics.failed}</div>
          <div className="statHint">Calls that need a retry or telephony configuration review.</div>
        </div>
        <div className="statCard">
          <div className="statLabel">Talk time</div>
          <div className="statValue">{formatDuration(metrics.totalDuration)}</div>
          <div className="statHint">Total completed call duration across the loaded result set.</div>
        </div>
      </div>

      <section className="card">
        <div className="row">
          <label className="grow">
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="initiated">Initiated</option>
              <option value="ringing">Ringing</option>
              <option value="in-progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
        </div>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Deal</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Recording</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>Loading call history...</td>
                </tr>
              ) : null}
              {!loading && calls.length === 0 ? (
                <tr>
                  <td colSpan={6}>No call records yet.</td>
                </tr>
              ) : null}
              {!loading
                ? calls.map((call) => (
                    <tr key={call.id}>
                      <td>{formatDateTime(call.started_at)}</td>
                      <td>{call.deal_title || "-"}</td>
                      <td>{call.contact_name || "-"}</td>
                      <td>
                        <span className={`statusPill ${call.status === "completed" ? "active" : call.status === "failed" ? "expired" : "expiringsoon"}`}>
                          {call.status}
                        </span>
                      </td>
                      <td>{formatDuration(call.duration_seconds)}</td>
                      <td>
                        {call.recording_url ? (
                          <a className="link" href={call.recording_url} target="_blank" rel="noopener noreferrer">
                            Open recording
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
