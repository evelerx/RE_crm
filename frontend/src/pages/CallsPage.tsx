// MODIFIED: Part 5H — Calls page scaffold — Adds the requested calls workspace UI without changing the existing activity/calling logic.
const callRows = [
  { contact: "Aditi Shah", phone: "+91 98342 41892", direction: "outbound", duration: "04:18", status: "answered", date: "Today, 10:24", recording: true, deal: "Palm Avenue 2BHK" },
  { contact: "Rohan Mehta", phone: "+91 99221 14400", direction: "inbound", duration: "00:48", status: "missed", date: "Today, 09:11", recording: false, deal: "Trade Square Retail" },
  { contact: "Pooja Kulkarni", phone: "+91 99701 22114", direction: "outbound", duration: "02:31", status: "busy", date: "Yesterday, 18:42", recording: false, deal: "Blue Ridge" },
];

function chipClass(value: string) {
  if (value === "answered") return "chip chip-success";
  if (value === "missed") return "chip chip-danger";
  if (value === "busy") return "chip chip-warning";
  return "chip chip-gray";
}

function directionClass(value: string) {
  return value === "inbound" ? "chip chip-teal" : "chip chip-blue";
}

export default function CallsPage() {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Calls</div>
          <div className="muted">Review call direction, outcomes, and recordings from one place.</div>
        </div>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Phone</th>
              <th>Direction</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Recording</th>
              <th>Date</th>
              <th>Deal link</th>
            </tr>
          </thead>
          <tbody>
            {callRows.map((row) => (
              <tr key={`${row.contact}-${row.date}`}>
                <td>{row.contact}</td>
                <td>{row.phone}</td>
                <td><span className={directionClass(row.direction)}>{row.direction}</span></td>
                <td>{row.duration}</td>
                <td><span className={chipClass(row.status)}>{row.status}</span></td>
                <td>{row.recording ? <button className="btn ghost compact" type="button">▶ Play</button> : "-"}</td>
                <td>{row.date}</td>
                <td>{row.deal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
