// MODIFIED: Inventory-to-deals wiring — Replaces the fake inventory seed with live CRM deal-backed properties, plus add-property and status update actions.
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { Deal } from "../api/types";

type InventoryStatus = Deal["inventory_status"];

type PropertyForm = {
  title: string;
  asset_type: Deal["asset_type"];
  city: string;
  area: string;
  typology: string;
  ticket_size: string;
  inventory_status: InventoryStatus;
};

const emptyForm: PropertyForm = {
  title: "",
  asset_type: "residential",
  city: "",
  area: "",
  typology: "",
  ticket_size: "",
  inventory_status: "available",
};

function formatTicket(value: number | null) {
  if (value == null) return "-";
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function normalizeStatus(deal: Deal): InventoryStatus {
  if (deal.inventory_status) return deal.inventory_status;
  if (deal.stage === "closed" || deal.status === "closed") return "sold";
  if (deal.stage === "lost" || deal.status === "lost") return "blocked";
  return "available";
}

export default function PropertiesPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<PropertyForm>(emptyForm);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const rows = await api<Deal[]>("/deals");
      const withStatus = rows.map((row) => ({ ...row, inventory_status: normalizeStatus(row) }));
      setDeals(withStatus);
      setSelectedId((current) => current ?? withStatus[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => {
    const counts = { total: deals.length, available: 0, soft_hold: 0, blocked: 0, sold: 0 };
    for (const deal of deals) {
      counts[normalizeStatus(deal)] += 1;
    }
    return counts;
  }, [deals]);

  const selected = useMemo(() => deals.find((deal) => deal.id === selectedId) ?? null, [deals, selectedId]);

  async function updateInventoryStatus(status: InventoryStatus) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<Deal> = { inventory_status: status };
      if (status === "sold") {
        payload.stage = "closed";
      }
      const updated = await api<Deal>(`/deals/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const normalized = { ...updated, inventory_status: normalizeStatus(updated) };
      setDeals((current) => current.map((row) => (row.id === selected.id ? normalized : row)));
      setMessage(`Inventory status updated to ${status.replace("_", " ")}.`);
      window.setTimeout(() => setMessage(null), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update property status.");
    } finally {
      setSaving(false);
    }
  }

  async function createProperty(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api<Deal>("/deals", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          asset_type: form.asset_type,
          city: form.city.trim(),
          area: form.area.trim(),
          typology: form.typology.trim(),
          ticket_size: form.ticket_size ? Number(form.ticket_size) : null,
          inventory_status: form.inventory_status,
          stage: form.inventory_status === "sold" ? "closed" : "lead",
        }),
      });
      const normalized = { ...created, inventory_status: normalizeStatus(created) };
      setDeals((current) => [normalized, ...current]);
      setSelectedId(normalized.id);
      setForm(emptyForm);
      setMessage("Property added to inventory.");
      window.setTimeout(() => setMessage(null), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add property.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Properties</div>
          <div className="muted">Track live project inventory from real deal records and add new properties directly here.</div>
        </div>
        <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <div className="alert err">{error}</div> : null}
      {message ? <div className="alert ok">{message}</div> : null}

      <section className="inventoryGrid">
        <div className="card card-pad">
          <div className="cardTitle">All properties</div>
          <div className="h1" style={{ fontSize: "2rem" }}>{grouped.total}</div>
          <div className="muted">Inventory synced from live CRM deal records.</div>
        </div>
        <div className="card card-pad">
          <div className="cardTitle">Available / held</div>
          <div className="h1" style={{ fontSize: "2rem" }}>{grouped.available + grouped.soft_hold}</div>
          <div className="muted">Available: {grouped.available} · Soft hold: {grouped.soft_hold}</div>
        </div>
        <div className="card card-pad">
          <div className="cardTitle">Blocked / sold</div>
          <div className="h1" style={{ fontSize: "2rem" }}>{grouped.blocked + grouped.sold}</div>
          <div className="muted">Blocked: {grouped.blocked} · Sold: {grouped.sold}</div>
        </div>
      </section>

      <div className="sequenceBuilderLayout">
        <section className="card card-pad">
          <div className="cardTitle">Add property</div>
          <form className="form" onSubmit={(event) => void createProperty(event)}>
            <div className="grid2">
              <label>
                Property name
                <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Prestige Park Grove" />
              </label>
              <label>
                Property type
                <select value={form.asset_type} onChange={(event) => setForm((current) => ({ ...current, asset_type: event.target.value as Deal["asset_type"] }))}>
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                  <option value="land">Land</option>
                  <option value="industrial">Industrial</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <div className="grid2">
              <label>
                City
                <input value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} placeholder="Pune" />
              </label>
              <label>
                Area / locality
                <input value={form.area} onChange={(event) => setForm((current) => ({ ...current, area: event.target.value }))} placeholder="Baner" />
              </label>
            </div>
            <div className="grid2">
              <label>
                Typology / unit type
                <input value={form.typology} onChange={(event) => setForm((current) => ({ ...current, typology: event.target.value }))} placeholder="2 BHK / Retail / Plot" />
              </label>
              <label>
                Price
                <input value={form.ticket_size} onChange={(event) => setForm((current) => ({ ...current, ticket_size: event.target.value }))} placeholder="12500000" />
              </label>
            </div>
            <label>
              Inventory status
              <select value={form.inventory_status} onChange={(event) => setForm((current) => ({ ...current, inventory_status: event.target.value as InventoryStatus }))}>
                <option value="available">Available</option>
                <option value="soft_hold">Soft hold</option>
                <option value="blocked">Blocked</option>
                <option value="sold">Sold</option>
              </select>
            </label>
            <button className="btn" type="submit" disabled={creating || !form.title.trim()}>
              {creating ? "Adding..." : "Add property"}
            </button>
          </form>
        </section>

        <section className="card card-pad">
          <div className="cardTitle">Inventory list</div>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="muted">Loading properties...</td>
                  </tr>
                ) : deals.length ? (
                  deals.map((deal) => {
                    const status = normalizeStatus(deal);
                    return (
                      <tr key={deal.id} onClick={() => setSelectedId(deal.id)} style={{ cursor: "pointer" }}>
                        <td className="tdTitle">{deal.title}</td>
                        <td>{deal.asset_type}</td>
                        <td>{[deal.area, deal.city].filter(Boolean).join(", ") || "-"}</td>
                        <td><span className={`chip chip-${status === "available" ? "success" : status === "soft_hold" ? "warning" : status === "blocked" ? "danger" : "teal"}`}>{status.replace("_", " ")}</span></td>
                        <td>{formatTicket(deal.ticket_size)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="muted">No properties yet. Add the first property above.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {selected ? (
        <section className="card card-pad inventoryUnitDetail">
          <div className="pageHeader">
            <div>
              <div className="cardTitle">{selected.title}</div>
              <div className="muted">This property is backed by the CRM deal record, so inventory and deal views stay aligned.</div>
            </div>
          </div>
          <div className="inventoryUnitMeta">
            <div><span className="section-label">Type</span><strong>{selected.asset_type}</strong></div>
            <div><span className="section-label">Typology</span><strong>{selected.typology || "-"}</strong></div>
            <div><span className="section-label">Location</span><strong>{[selected.area, selected.city].filter(Boolean).join(", ") || "-"}</strong></div>
            <div><span className="section-label">Price</span><strong>{formatTicket(selected.ticket_size)}</strong></div>
          </div>
          <div className="inventoryStatusRow">
            {(["available", "soft_hold", "blocked", "sold"] as InventoryStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                className={`inventoryStatusPill${normalizeStatus(selected) === status ? " active" : ""}`}
                onClick={() => void updateInventoryStatus(status)}
                disabled={saving}
              >
                {saving && normalizeStatus(selected) === status ? "Saving..." : status.replace("_", " ")}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
