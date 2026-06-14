// MODIFIED: Part 5E — Leaderboard page scaffold — Adds a performance ranking surface using stable mock ranking data until live team scoring is extended.
const leaderboardRows = [
  { rank: 1, agent: "Nihar Lakhani", role: "Owner", deals: 12, revenue: "₹2.8Cr", activities: 64, badge: "Top Closer" },
  { rank: 2, agent: "Kunj Sales Desk", role: "Broker", deals: 9, revenue: "₹1.9Cr", activities: 51, badge: "Most Active" },
  { rank: 3, agent: "Builder Success", role: "CP", deals: 7, revenue: "₹1.4Cr", activities: 39, badge: "Rising" },
  { rank: 4, agent: "West Zone Team", role: "Broker", deals: 5, revenue: "₹96L", activities: 32, badge: "" },
];

function badgeClass(badge: string) {
  if (badge === "Top Closer") return "chip chip-gold";
  if (badge === "Most Active") return "chip chip-teal";
  if (badge === "Rising") return "chip chip-blue";
  return "chip chip-gray";
}

export default function LeaderboardPage() {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Leaderboard</div>
          <div className="muted">Track closers, activity leaders, and momentum across the team.</div>
        </div>
      </div>

      <div className="leaderboardPodium">
        {leaderboardRows.slice(0, 3).map((row) => (
          <div key={row.rank} className={`leaderboardPodiumCard rank-${row.rank}`}>
            <div className="leaderboardAvatar">{row.agent.slice(0, 1)}</div>
            <div className="leaderboardRank">#{row.rank}</div>
            <strong>{row.agent}</strong>
            <span className={badgeClass(row.badge)}>{row.badge || "On track"}</span>
            <div className="leaderboardRevenue">{row.revenue}</div>
          </div>
        ))}
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Agent</th>
              <th>Role</th>
              <th>Deals closed</th>
              <th>Revenue</th>
              <th>Activities</th>
              <th>Badge</th>
            </tr>
          </thead>
          <tbody>
            {leaderboardRows.map((row) => (
              <tr key={row.rank}>
                <td>#{row.rank}</td>
                <td>{row.agent}</td>
                <td>{row.role}</td>
                <td>{row.deals}</td>
                <td>{row.revenue}</td>
                <td>{row.activities}</td>
                <td><span className={badgeClass(row.badge)}>{row.badge || "No badge"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
