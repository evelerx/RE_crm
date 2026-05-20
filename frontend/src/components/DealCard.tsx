import { Link } from "react-router-dom";
import type { Deal } from "../api/types";

function formatMoney(value: number | null) {
  if (value == null) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatTypology(deal: Deal) {
  const raw = deal.typology?.trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();

  if (deal.asset_type === "land" && !/(acre|acres|sq|sqft|sq ft|hectare|hectares|guntha|gunta)/.test(lower)) {
    return `${raw} acres`;
  }

  if (deal.asset_type === "industrial" && !/(sq|sqft|sq ft|square feet|acre|acres)/.test(lower)) {
    return `${raw} sq ft`;
  }

  return raw;
}

export default function DealCard({ deal }: { deal: Deal }) {
  const typologyLabel = formatTypology(deal);

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
      {typologyLabel ? <div className="muted small">{typologyLabel}</div> : null}
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
