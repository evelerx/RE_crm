import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE_URL, api, apiBlob, apiForm, closureFeed } from "../api/client";
import type { Deal, DealClosureEvent } from "../api/types";

function fmt(value: number | null, suffix = "") {
  if (value == null) return "-";
  return `${value}${suffix}`;
}

function formatTicket(value: number | null) {
  if (value == null) return "-";
  return `Rs ${value.toLocaleString()}`;
}

function formatVisitDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "-";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function DealsGridPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feed, setFeed] = useState<DealClosureEvent[]>([]);
  const [newFeedIds, setNewFeedIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkStage, setBulkStage] = useState<Deal["stage"]>("lead");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (search: string) => {
    setError(null);
    setLoading(true);
    try {
      const qq = search.trim();
      const data = await api<Deal[]>(qq ? `/deals?q=${encodeURIComponent(qq)}` : "/deals");
      setDeals(data);
      setSelected({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  useEffect(() => {
    let active = true;
    const fetchFeed = async () => {
      try {
        const data = await closureFeed();
        if (!active) return;
        setFeed((prev) => {
          const known = new Set(prev.map((item) => item.id));
          const fresh = data.filter((item) => !known.has(item.id)).map((item) => item.id);
          if (fresh.length) {
            setNewFeedIds(fresh);
            window.setTimeout(() => setNewFeedIds([]), 3000);
          }
          return data;
        });
      } catch {
        // keep quiet on transient poll errors
      }
    };
    void fetchFeed();
    const timer = window.setInterval(fetchFeed, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function deleteDeal(deal: Deal) {
    const confirmed = window.confirm(`Delete deal "${deal.title}"? This cannot be undone.`);
    if (!confirmed) return;
    setDeletingId(deal.id);
    setError(null);
    try {
      await api<{ deleted: boolean }>(`/deals/${deal.id}`, { method: "DELETE" });
      setDeals((prev) => prev.filter((row) => row.id !== deal.id));
      setSelected((prev) => {
        const next = { ...prev };
        delete next[deal.id];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete deal");
    } finally {
      setDeletingId(null);
    }
  }

  const rows = useMemo(() => deals, [deals]);
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Deals</div>
          <div className="muted">Search and manage deals.</div>
        </div>
        <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void load(q);
            }}
          >
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, location, typology, phase, stage, or any keyword" />
            <button className="btn" type="submit">
              Search
            </button>
          </form>
          <button
            className="btn ghost"
            type="button"
            onClick={async () => {
              try {
                const blob = await apiBlob("/csv/export/deals");
                downloadBlob("deals.csv", blob);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Export failed");
              }
            }}
          >
            Export CSV
          </button>
          <label className="btn ghost" style={{ cursor: "pointer" }}>
            Import CSV/XLSX
            <input
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const fd = new FormData();
                  fd.append("file", file);
                  await apiForm<{ created: number }>("/csv/import/deals", fd);
                  await load("");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Import failed");
                } finally {
                  e.target.value = "";
                }
              }}
            />
          </label>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      {selectedIds.length > 0 ? (
        <div className="card" style={{ padding: 10 }}>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <div className="muted">
              Selected <b>{selectedIds.length}</b>
            </div>
            <select value={bulkStage} onChange={(e) => setBulkStage(e.target.value as Deal["stage"])} style={{ width: 180 }}>
              <option value="lead">Lead</option>
              <option value="visit">Visit</option>
              <option value="negotiation">Negotiation</option>
              <option value="closed">Closed</option>
              <option value="lost">Lost</option>
            </select>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                try {
                  await api<{ updated: number }>("/deals/bulk-stage", {
                    method: "PATCH",
                    body: JSON.stringify({ ids: selectedIds, stage: bulkStage })
                  });
                  await load(q);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Bulk update failed");
                }
              }}
            >
              Apply stage
            </button>
            <button className="btn ghost" type="button" onClick={() => setSelected({})} title="Clear selection">
              Clear
            </button>
          </div>
        </div>
      ) : null}

      <div className="dealsGridLayout">
        <div className="tableWrap tableWrapWide">
          <table className="table tableWide">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => {
                    if (allSelected) {
                      setSelected({});
                    } else {
                      const next: Record<string, boolean> = {};
                      rows.forEach((d) => {
                        next[d.id] = true;
                      });
                      setSelected(next);
                    }
                  }}
                />
              </th>
              <th>Photo</th>
              <th>Title</th>
              <th>Asset</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Client phase</th>
              <th>Location</th>
              <th>Date of visit</th>
              <th>Typology</th>
              <th>Customer budget</th>
              <th>Ticket</th>
              <th>Close %</th>
              <th>Yield %</th>
              <th>ROI %</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(selected[d.id])}
                    onChange={() =>
                      setSelected((prev) => ({
                        ...prev,
                        [d.id]: !prev[d.id]
                      }))
                    }
                  />
                </td>
                <td>
                  {d.primary_image_url ? (
                    <img className="dealTableThumb" src={`${API_BASE_URL}${d.primary_image_url}`} alt={d.title} />
                  ) : (
                    <span className="muted small">No photo</span>
                  )}
                </td>
                <td className="tdTitle">
                  <Link to={`/deals/${d.id}`} className="rowLink">
                    {d.title}
                  </Link>
                </td>
                <td>{d.asset_type}</td>
                <td>{d.stage}</td>
                <td>
                  {d.status === "closed" ? (
                    <div className="stack compact">
                      <span className="pill pillClosed">Closed</span>
                      <span className="muted small">Closed by {d.closed_by_user_name || "Unknown"}</span>
                      <span className="muted small">{relativeTime(d.closed_at)}</span>
                    </div>
                  ) : (
                    <span className="muted small">{d.status || "open"}</span>
                  )}
                </td>
                <td>{d.client_phase || "-"}</td>
                <td>
                  {d.area || "-"}
                  {d.city ? <span className="muted">, {d.city}</span> : null}
                </td>
                <td>{formatVisitDate(d.visit_date)}</td>
                <td>{d.typology || "-"}</td>
                <td>{formatTicket(d.customer_budget)}</td>
                <td>{formatTicket(d.ticket_size)}</td>
                <td>{fmt(d.close_probability)}</td>
                <td>{fmt(d.expected_yield_pct)}</td>
                <td>{fmt(d.expected_roi_pct)}</td>
                <td>
                  <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                    <Link to={`/deals/${d.id}`} className="btn ghost">
                      Open
                    </Link>
                    <button className="btn ghost" type="button" onClick={() => void deleteDeal(d)} disabled={deletingId === d.id}>
                      {deletingId === d.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {loading ? (
              [1, 2, 3, 4, 5].map((i) => (
                <tr key={i}>
                  {[60, 40, 30, 35, 40, 25, 30, 35, 30, 25, 20, 20, 20, 20, 50].map((w, j) => (
                    <td key={j}><div className="skeletonBar" style={{ width: `${w}%` }} /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={16} className="muted">
                  No deals found.
                </td>
              </tr>
            ) : null}
          </tbody>
          </table>
        </div>
        <aside className="closureFeedPanel">
          <div className="cardTitle">Closure Feed</div>
          <div className="muted small">Org-wide deal closures refresh every 60 seconds.</div>
          <div className="list">
            {feed.length === 0 ? <div className="muted">No closures yet</div> : null}
            {feed.map((item) => (
              <div key={item.id} className={`listItem ${newFeedIds.includes(item.id) ? "feedRowNew" : ""}`}>
                <div>
                  <strong>{item.closed_by_name}</strong> closed <strong>{item.deal_title}</strong>
                </div>
                <div className="muted small">
                  {item.property_name || "-"} - {relativeTime(item.closed_at)}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
