import { Link } from "react-router-dom";
import type { Deal } from "../api/types";

function formatMoney(value: number | null) {
  if (value == null) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function DealCard({ deal }: { deal: Deal }) {
  return (
    <Link to={`/deals/${deal.id}`} className="dealCard">
      <div className="dcTop">
        <div className="dcTitle">{deal.title}</div>
        <div className="pill">{deal.asset_type}</div>
      </div>
      <div className="dcMeta">
        <div className="muted">
          {deal.area || "Area"}
          {deal.city ? `, ${deal.city}` : ""}
        </div>
        <div className="muted">Rs {formatMoney(deal.ticket_size)}</div>
      </div>
      <div className="dcBottom">
        <div className="mini">
          Close: <b>{deal.close_probability ?? "-"}%</b>
        </div>
        <div className="mini">
          Yield: <b>{deal.expected_yield_pct ?? "-"}%</b>
        </div>
      </div>
    </Link>
  );
}
