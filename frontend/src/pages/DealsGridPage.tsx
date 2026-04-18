import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiBlob, apiForm } from "../api/client";
import type { Deal } from "../api/types";

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
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkStage, setBulkStage] = useState<Deal["stage"]>("lead");

  async function load(search?: string) {
    setError(null);
    try {
      const qq = (search ?? q).trim();
      const data = await api<Deal[]>(qq ? `/deals?q=${encodeURIComponent(qq)}` : "/deals");
      setDeals(data);
      setSelected({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deals");
    }
  }

  useEffect(() => {
    void load("");
  }, []);

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
              void load();
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
                  await load();
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
              <th>Title</th>
              <th>Asset</th>
              <th>Stage</th>
              <th>Client phase</th>
              <th>Location</th>
              <th>Date of visit</th>
              <th>Typology</th>
              <th>Customer budget</th>
              <th>Ticket</th>
              <th>Close %</th>
              <th>Yield %</th>
              <th>ROI %</th>
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
                <td className="tdTitle">
                  <Link to={`/deals/${d.id}`} className="rowLink">
                    {d.title}
                  </Link>
                </td>
                <td>{d.asset_type}</td>
                <td>{d.stage}</td>
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
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="muted">
                  No deals found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
