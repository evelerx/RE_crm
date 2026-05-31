import { Link } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
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

function relativeTime(value: string | null | undefined) {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DealCard({ deal, onAddPhoto }: { deal: Deal; onAddPhoto?: (dealId: string) => void }) {
  const typologyLabel = formatTypology(deal);

  return (
    <Link to={`/deals/${deal.id}`} className="dealCard">
      {deal.primary_image_url ? (
        <img className="dealCardImage" src={`${API_BASE_URL}${deal.primary_image_url}`} alt={deal.title} />
      ) : onAddPhoto ? (
        <button
          type="button"
          className="dealCardImagePlaceholder"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAddPhoto(deal.id);
          }}
        >
          <span className="dealCardImagePlaceholderIcon">+</span>
          <span>Add photo</span>
        </button>
      ) : null}
      <div className="dcTop">
        <div className="dcTitle">{deal.title}</div>
        <div className={`pill ${deal.status === "closed" ? "pillClosed" : ""}`}>{deal.status === "closed" ? "Closed" : deal.asset_type}</div>
      </div>
      <div className="dcMeta">
        <div className="muted">
          {deal.area || "Area"}
          {deal.city ? `, ${deal.city}` : ""}
        </div>
        <div className="muted">Rs {formatMoney(deal.ticket_size)}</div>
      </div>
      {typologyLabel ? <div className="muted small">{typologyLabel}</div> : null}
      {deal.status === "closed" ? (
        <div className="muted small">Closed by {deal.closed_by_user_name || "Unknown"} - {relativeTime(deal.closed_at)}</div>
      ) : null}
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
