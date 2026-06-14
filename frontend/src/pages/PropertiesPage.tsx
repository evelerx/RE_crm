// MODIFIED: Part 5D — Properties / inventory page scaffold — Adds the requested inventory workspace UI without touching core CRM logic.
import { useMemo, useState } from "react";

type UnitStatus = "available" | "soft_hold" | "blocked" | "sold";

type Unit = {
  id: string;
  label: string;
  area: string;
  floor: string;
  type: string;
  price: string;
  status: UnitStatus;
};

type Project = {
  id: string;
  name: string;
  location: string;
  propertyType: string;
  units: Unit[];
};

const projectsSeed: Project[] = [
  {
    id: "project-1",
    name: "Palm Avenue Residences",
    location: "Pune West",
    propertyType: "Residential",
    units: [
      { id: "u-101", label: "101", area: "785 sq ft", floor: "1", type: "2 BHK", price: "₹78L", status: "available" },
      { id: "u-102", label: "102", area: "820 sq ft", floor: "1", type: "2 BHK", price: "₹81L", status: "soft_hold" },
      { id: "u-201", label: "201", area: "1105 sq ft", floor: "2", type: "3 BHK", price: "₹1.14Cr", status: "blocked" },
      { id: "u-202", label: "202", area: "1105 sq ft", floor: "2", type: "3 BHK", price: "₹1.16Cr", status: "sold" },
    ],
  },
  {
    id: "project-2",
    name: "Trade Square",
    location: "Thane Central",
    propertyType: "Commercial",
    units: [
      { id: "c-11", label: "C11", area: "420 sq ft", floor: "Ground", type: "Retail", price: "₹1.42Cr", status: "available" },
      { id: "c-12", label: "C12", area: "420 sq ft", floor: "Ground", type: "Retail", price: "₹1.39Cr", status: "available" },
      { id: "c-18", label: "C18", area: "670 sq ft", floor: "1", type: "Office", price: "₹1.95Cr", status: "soft_hold" },
    ],
  },
];

export default function PropertiesPage() {
  const [projects, setProjects] = useState(projectsSeed);
  const [selectedProjectId, setSelectedProjectId] = useState(projectsSeed[0]?.id ?? "");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );
  const selectedUnit = selectedProject?.units.find((unit) => unit.id === selectedUnitId) ?? null;

  function statusCounts(project: Project) {
    return project.units.reduce(
      (acc, unit) => {
        acc.total += 1;
        acc[unit.status] += 1;
        return acc;
      },
      { total: 0, available: 0, soft_hold: 0, blocked: 0, sold: 0 },
    );
  }

  function setUnitStatus(status: UnitStatus) {
    if (!selectedProject || !selectedUnitId) return;
    setProjects((current) =>
      current.map((project) =>
        project.id !== selectedProject.id
          ? project
          : {
              ...project,
              units: project.units.map((unit) => (unit.id === selectedUnitId ? { ...unit, status } : unit)),
            },
      ),
    );
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Properties</div>
          <div className="muted">Track project inventory, unit status, and deal linkage at a glance.</div>
        </div>
      </div>

      <section className="inventoryGrid">
        {projects.map((project) => {
          const counts = statusCounts(project);
          return (
            <button
              key={project.id}
              type="button"
              className={`inventoryProjectCard${project.id === selectedProject?.id ? " active" : ""}`}
              onClick={() => {
                setSelectedProjectId(project.id);
                setSelectedUnitId(null);
              }}
            >
              <div className="inventoryProjectHead">
                <div>
                  <div className="inventoryProjectTitle">{project.name}</div>
                  <div className="muted">{project.location}</div>
                </div>
                <span className="chip chip-gray">{project.propertyType}</span>
              </div>
              <div className="inventoryProjectStats">
                <span><strong>{counts.total}</strong> total</span>
                <span className="inventoryStatGood"><strong>{counts.available}</strong> available</span>
                <span className="inventoryStatWarn"><strong>{counts.soft_hold}</strong> held</span>
                <span className="inventoryStatMute"><strong>{counts.sold}</strong> sold</span>
              </div>
            </button>
          );
        })}
      </section>

      {selectedProject ? (
        <section className="card card-pad">
          <div className="pageHeader">
            <div>
              <div className="cardTitle">{selectedProject.name}</div>
              <div className="muted">Select a unit to inspect pricing, type, and status.</div>
            </div>
          </div>
          <div className="inventoryUnitGrid">
            {selectedProject.units.map((unit) => (
              <button
                key={unit.id}
                type="button"
                className={`inventoryUnitTile status-${unit.status}${selectedUnitId === unit.id ? " active" : ""}`}
                title={`${unit.label} • ${unit.area}`}
                onClick={() => setSelectedUnitId(unit.id)}
              >
                <span>{unit.label}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selectedUnit ? (
        <section className="card card-pad inventoryUnitDetail">
          <div className="cardTitle">Unit {selectedUnit.label}</div>
          <div className="inventoryUnitMeta">
            <div><span className="section-label">Floor</span><strong>{selectedUnit.floor}</strong></div>
            <div><span className="section-label">Type</span><strong>{selectedUnit.type}</strong></div>
            <div><span className="section-label">Area</span><strong>{selectedUnit.area}</strong></div>
            <div><span className="section-label">Price</span><strong>{selectedUnit.price}</strong></div>
          </div>
          <div className="inventoryStatusRow">
            {(["available", "soft_hold", "blocked", "sold"] as UnitStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                className={`inventoryStatusPill${selectedUnit.status === status ? " active" : ""}`}
                onClick={() => setUnitStatus(status)}
              >
                {status.replace("_", " ")}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
