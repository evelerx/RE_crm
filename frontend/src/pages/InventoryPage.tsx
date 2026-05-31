import { useEffect, useMemo, useState } from "react";
import {
  api,
  bookInventoryUnit,
  bulkCreateInventoryUnits,
  createInventoryProject,
  getInventoryProjectSummary,
  listInventoryProjects,
  listInventoryUnits,
  updateInventoryUnit,
} from "../api/client";
import type { Deal, InventoryProject, InventoryProjectSummary, InventoryUnit } from "../api/types";

type UnitDraft = {
  unit_number: string;
  tower: string;
  floor: string;
  bhk_type: string;
  area_sqft: string;
  base_price: string;
  status: string;
};

const emptyUnitDraft: UnitDraft = {
  unit_number: "",
  tower: "",
  floor: "",
  bhk_type: "",
  area_sqft: "",
  base_price: "",
  status: "available",
};

function formatMoney(value: number | null | undefined) {
  if (value == null) return "-";
  return `Rs ${value.toLocaleString()}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

export default function InventoryPage() {
  const [projects, setProjects] = useState<InventoryProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [summary, setSummary] = useState<InventoryProjectSummary | null>(null);
  const [dealOptions, setDealOptions] = useState<Deal[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [bhkFilter, setBhkFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [unitBusyId, setUnitBusyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [projectForm, setProjectForm] = useState({
    name: "",
    location: "",
    total_units: "",
    launch_date: "",
  });
  const [unitDrafts, setUnitDrafts] = useState<UnitDraft[]>([{ ...emptyUnitDraft }]);

  async function loadProjects() {
    const rows = await listInventoryProjects();
    setProjects(rows);
    if (!selectedProjectId && rows[0]) setSelectedProjectId(rows[0].id);
  }

  async function loadDeals() {
    const rows = await api<Deal[]>("/deals");
    setDealOptions(rows);
  }

  async function loadProjectDetails(projectId: string) {
    if (!projectId) {
      setUnits([]);
      setSummary(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [unitRows, summaryRow] = await Promise.all([
        listInventoryUnits(projectId, {
          status: statusFilter || undefined,
          bhk_type: bhkFilter || undefined,
        }),
        getInventoryProjectSummary(projectId),
      ]);
      setUnits(unitRows);
      setSummary(summaryRow);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load inventory");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.all([loadProjects(), loadDeals()]).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not load inventory data");
    });
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    void loadProjectDetails(selectedProjectId);
  }, [selectedProjectId, statusFilter, bhkFilter]);

  const uniqueBhkTypes = useMemo(() => Array.from(new Set(units.map((unit) => unit.bhk_type).filter(Boolean))), [units]);

  async function handleCreateProject() {
    if (!projectForm.name.trim() || !projectForm.location.trim() || !projectForm.total_units.trim()) {
      setError("Project name, location, and total units are required.");
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const created = await createInventoryProject({
        name: projectForm.name.trim(),
        location: projectForm.location.trim(),
        total_units: Number(projectForm.total_units),
        launch_date: projectForm.launch_date || null,
      });
      setProjectForm({ name: "", location: "", total_units: "", launch_date: "" });
      await loadProjects();
      setSelectedProjectId(created.id);
      setSuccess("Project created");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create project");
    }
  }

  function updateDraft(index: number, patch: Partial<UnitDraft>) {
    setUnitDrafts((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  async function handleCreateUnits() {
    if (!selectedProjectId) {
      setError("Choose a project first.");
      return;
    }
    const payload = unitDrafts
      .filter((draft) => draft.unit_number.trim())
      .map((draft) => ({
        unit_number: draft.unit_number.trim(),
        tower: draft.tower.trim() || null,
        floor: draft.floor.trim() ? Number(draft.floor) : null,
        bhk_type: draft.bhk_type.trim(),
        area_sqft: Number(draft.area_sqft),
        base_price: Number(draft.base_price),
        status: draft.status,
      }));
    if (payload.length === 0 || payload.some((draft) => !draft.bhk_type || !draft.area_sqft || !draft.base_price)) {
      setError("Each unit needs number, BHK type, area, and base price.");
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      await bulkCreateInventoryUnits(selectedProjectId, payload);
      setUnitDrafts([{ ...emptyUnitDraft }]);
      await loadProjectDetails(selectedProjectId);
      await loadProjects();
      setSuccess("Units added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create units");
    }
  }

  async function handleStatusChange(unit: InventoryUnit, nextStatus: string) {
    setUnitBusyId(unit.id);
    setError(null);
    try {
      await updateInventoryUnit(unit.id, { status: nextStatus });
      await loadProjectDetails(unit.project_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update unit");
    } finally {
      setUnitBusyId("");
    }
  }

  async function handleBookUnit(unit: InventoryUnit) {
    const preferredDealId = unit.deal_id || dealOptions[0]?.id || "";
    const dealId = window.prompt("Enter deal ID to book this unit against", preferredDealId);
    if (!dealId) return;
    setUnitBusyId(unit.id);
    setError(null);
    try {
      await bookInventoryUnit(unit.id, dealId.trim());
      await loadProjectDetails(unit.project_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not book unit");
    } finally {
      setUnitBusyId("");
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Inventory</div>
          <div className="muted">Create builder projects, track unit availability, and book inventory against live deals.</div>
        </div>
        <button className="btn ghost" onClick={() => void Promise.all([loadProjects(), selectedProjectId ? loadProjectDetails(selectedProjectId) : Promise.resolve()])} type="button">
          Refresh
        </button>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {success ? <div className="alert ok">{success}</div> : null}

      <div className="detailGrid">
        <section className="card">
          <div className="cardTitle">Create Project</div>
          <div className="form">
            <label>
              Project name
              <input value={projectForm.name} onChange={(e) => setProjectForm((prev) => ({ ...prev, name: e.target.value }))} />
            </label>
            <label>
              Location
              <input value={projectForm.location} onChange={(e) => setProjectForm((prev) => ({ ...prev, location: e.target.value }))} />
            </label>
            <div className="grid2">
              <label>
                Total units
                <input
                  inputMode="numeric"
                  value={projectForm.total_units}
                  onChange={(e) => setProjectForm((prev) => ({ ...prev, total_units: e.target.value }))}
                />
              </label>
              <label>
                Launch date
                <input
                  type="date"
                  value={projectForm.launch_date}
                  onChange={(e) => setProjectForm((prev) => ({ ...prev, launch_date: e.target.value }))}
                />
              </label>
            </div>
            <div className="row right">
              <button className="btn" onClick={() => void handleCreateProject()} type="button">
                Create project
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="cardTitle">Project Summary</div>
          <label>
            Active project
            <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              <option value="">Select a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} - {project.location}
                </option>
              ))}
            </select>
          </label>
          {summary ? (
            <div className="statsGrid">
              <div className="statCard">
                <div className="statLabel">Available</div>
                <div className="statValue">{summary.available_count}</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Booked</div>
                <div className="statValue">{summary.booked_count}</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Sold</div>
                <div className="statValue">{summary.sold_count}</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Inventory value</div>
                <div className="statValue">{formatMoney(summary.total_inventory_value)}</div>
              </div>
            </div>
          ) : (
            <div className="muted">Choose a project to see unit totals and valuation.</div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="cardTitle">Bulk Add Units</div>
          <button className="btn ghost" onClick={() => setUnitDrafts((prev) => [...prev, { ...emptyUnitDraft }])} type="button">
            Add row
          </button>
        </div>
        <div className="inventoryDraftList">
          {unitDrafts.map((draft, index) => (
            <div key={`draft-${index}`} className="inventoryDraftRow">
              <div className="grid2">
                <label>
                  Unit number
                  <input value={draft.unit_number} onChange={(e) => updateDraft(index, { unit_number: e.target.value })} />
                </label>
                <label>
                  Tower
                  <input value={draft.tower} onChange={(e) => updateDraft(index, { tower: e.target.value })} />
                </label>
                <label>
                  Floor
                  <input value={draft.floor} onChange={(e) => updateDraft(index, { floor: e.target.value })} />
                </label>
                <label>
                  BHK type
                  <input value={draft.bhk_type} onChange={(e) => updateDraft(index, { bhk_type: e.target.value })} />
                </label>
                <label>
                  Area (sqft)
                  <input value={draft.area_sqft} onChange={(e) => updateDraft(index, { area_sqft: e.target.value })} />
                </label>
                <label>
                  Base price
                  <input value={draft.base_price} onChange={(e) => updateDraft(index, { base_price: e.target.value })} />
                </label>
              </div>
              <div className="row right">
                {unitDrafts.length > 1 ? (
                  <button
                    className="btn ghost"
                    onClick={() => setUnitDrafts((prev) => prev.filter((_, rowIndex) => rowIndex !== index))}
                    type="button"
                  >
                    Remove row
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className="row right">
          <button className="btn" onClick={() => void handleCreateUnits()} type="button">
            Save units
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="cardTitle">Unit Board</div>
          <div className="row">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="available">Available</option>
              <option value="blocked">Blocked</option>
              <option value="booked">Booked</option>
              <option value="sold">Sold</option>
            </select>
            <select value={bhkFilter} onChange={(e) => setBhkFilter(e.target.value)}>
              <option value="">All BHK types</option>
              {uniqueBhkTypes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        {loading ? <div className="muted">Loading units...</div> : null}
        {!loading && units.length === 0 ? <div className="muted">No units yet for this project.</div> : null}
        <div className="inventoryUnitGrid">
          {units.map((unit) => (
            <div key={unit.id} className="inventoryUnitCard">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div className="dcTitle">{unit.unit_number}</div>
                  <div className="muted small">
                    {unit.tower ? `${unit.tower} | ` : ""}
                    {unit.floor != null ? `Floor ${unit.floor} | ` : ""}
                    {unit.bhk_type}
                  </div>
                </div>
                <span className={`statusPill ${unit.status === "available" ? "active" : unit.status === "sold" ? "expired" : "expiringsoon"}`}>
                  {unit.status}
                </span>
              </div>
              <div className="list">
                <div className="listItem">
                  <div className="muted">Area</div>
                  <div>{unit.area_sqft} sqft</div>
                </div>
                <div className="listItem">
                  <div className="muted">Current price</div>
                  <div>{formatMoney(unit.current_price ?? unit.base_price)}</div>
                </div>
                {unit.deal_title ? (
                  <div className="listItem">
                    <div className="muted">Linked deal</div>
                    <div>{unit.deal_title}</div>
                  </div>
                ) : null}
                {unit.booked_at ? (
                  <div className="listItem">
                    <div className="muted">Booked at</div>
                    <div>{formatDate(unit.booked_at)}</div>
                  </div>
                ) : null}
              </div>
              <div className="row">
                <button
                  className="btn ghost"
                  disabled={unitBusyId === unit.id}
                  onClick={() => void handleStatusChange(unit, unit.status === "available" ? "blocked" : "available")}
                  type="button"
                >
                  {unit.status === "available" ? "Block unit" : "Mark available"}
                </button>
                <button
                  className="btn"
                  disabled={unitBusyId === unit.id || unit.status === "sold"}
                  onClick={() => void handleBookUnit(unit)}
                  type="button"
                >
                  {unitBusyId === unit.id ? "Saving..." : unit.status === "booked" ? "Rebook" : "Book"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
