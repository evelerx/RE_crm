// MODIFIED: Part 5F — Targets page scaffold — Adds the requested target tracking surface while preserving current business logic.
const targetRows = [
  { owner: "West Zone", metric: "Deals closed", actual: 8, target: 12 },
  { owner: "Builder team", metric: "Site visits", actual: 16, target: 20 },
  { owner: "Solo desk", metric: "Follow-ups", actual: 24, target: 30 },
];

export default function TargetsPage() {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Targets</div>
          <div className="muted">Monitor target vs actual progress for teams and owners.</div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Owner</th>
                <th>Metric</th>
                <th>Actual</th>
                <th>Target</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {targetRows.map((row) => {
                const percent = Math.min(100, Math.round((row.actual / row.target) * 100));
                return (
                  <tr key={`${row.owner}-${row.metric}`}>
                    <td>{row.owner}</td>
                    <td>{row.metric}</td>
                    <td>{row.actual}</td>
                    <td>{row.target}</td>
                    <td>
                      <div className="targetProgressBar">
                        <div className="targetProgressFill" style={{ width: `${percent}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
