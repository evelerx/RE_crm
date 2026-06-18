// MODIFIED: RBAC feature parity — Replaced mock leaderboard data with live scoped leaderboard API so "view_leaderboard" reflects a real working feature.
import { useEffect, useMemo, useState } from "react";

import { listLeaderboard } from "../api/client";
import type { LeaderboardRow } from "../api/types";

function formatRupees(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function badgeClass(rank: number) {
  if (rank === 1) return "chip chip-gold";
  if (rank === 2) return "chip chip-teal";
  if (rank === 3) return "chip chip-blue";
  return "chip chip-gray";
}

function badgeLabel(rank: number, row: LeaderboardRow) {
  if (rank === 1) return "Top closer";
  if (row.activities_total >= 20) return "Most active";
  if (row.score >= 70) return "On track";
  return "Building";
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await listLeaderboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const podium = useMemo(() => rows.slice(0, 3), [rows]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Leaderboard</div>
          <div className="muted">Track closers, activity leaders, and momentum across the current workspace.</div>
        </div>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="leaderboardPodium">
        {(loading ? Array.from({ length: 3 }, () => null as LeaderboardRow | null) : podium.map((row) => row as LeaderboardRow | null)).map((row, index) =>
          row ? (
            <div key={row.user_id} className={`leaderboardPodiumCard rank-${index + 1}`}>
              <div className="leaderboardAvatar">{row.name.slice(0, 1).toUpperCase()}</div>
              <div className="leaderboardRank">#{index + 1}</div>
              <strong>{row.name}</strong>
              <span className={badgeClass(index + 1)}>{badgeLabel(index + 1, row)}</span>
              <div className="leaderboardRevenue">{formatRupees(row.revenue_inr)}</div>
            </div>
          ) : (
            <div key={`skeleton-${index}`} className={`leaderboardPodiumCard rank-${index + 1}`}>
              <div className="skeletonBar" style={{ width: "42%", height: 56, borderRadius: 16 }} />
              <div className="skeletonBar" style={{ width: "26%" }} />
              <div className="skeletonBar" style={{ width: "72%" }} />
              <div className="skeletonBar" style={{ width: "40%" }} />
              <div className="skeletonBar" style={{ width: "54%" }} />
            </div>
          ),
        )}
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Agent</th>
              <th>Role</th>
              <th>Deals closed</th>
              <th>Deals total</th>
              <th>Contacts</th>
              <th>Activities</th>
              <th>Site visits</th>
              <th>Follow-ups</th>
              <th>Revenue</th>
              <th>Score</th>
              <th>Badge</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, rowIndex) => (
                  <tr key={`loading-${rowIndex}`}>
                    {Array.from({ length: 12 }).map((__, cellIndex) => (
                      <td key={cellIndex}>
                        <div className="skeletonBar" style={{ width: `${45 + ((rowIndex + cellIndex) % 4) * 10}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, index) => (
                  <tr key={row.user_id}>
                    <td>#{index + 1}</td>
                    <td className="tdTitle">{row.name}</td>
                    <td>{row.role || "-"}</td>
                    <td>{row.deals_closed}</td>
                    <td>{row.deals_total}</td>
                    <td>{row.contacts_total}</td>
                    <td>{row.activities_total}</td>
                    <td>{row.site_visits_total}</td>
                    <td>{row.follow_ups_total}</td>
                    <td>{formatRupees(row.revenue_inr)}</td>
                    <td>{row.score}</td>
                    <td><span className={badgeClass(index + 1)}>{badgeLabel(index + 1, row)}</span></td>
                  </tr>
                ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="muted">
                  No live team activity yet. Close deals, add contacts, and log follow-ups to populate the leaderboard.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
