import { DndContext, DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "../api/client";
import type { AssetType, Contact, Deal, DealCreate, Stage } from "../api/types";
import DealCard from "../components/DealCard";
import Modal from "../components/Modal";

const STAGES: Stage[] = ["lead", "visit", "negotiation", "closed", "lost"];

function stageLabel(stage: Stage) {
  switch (stage) {
    case "lead":
      return "Lead";
    case "visit":
      return "Visit";
    case "negotiation":
      return "Negotiation";
    case "closed":
      return "Closed";
    case "lost":
      return "Lost";
  }
}

export default function PipelinePage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setDeals(await api<Deal[]>("/deals"));
      setContacts(await api<Contact[]>("/contacts"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const byStage = useMemo(() => {
    const map = new Map<Stage, Deal[]>();
    for (const st of STAGES) map.set(st, []);
    for (const d of deals) map.get(d.stage)?.push(d);
    return map;
  }, [deals]);

  async function onDragEnd(event: DragEndEvent) {
    const dealId = String(event.active.id);
    const overStage = event.over?.id ? String(event.over.id) : null;
    if (!overStage) return;
    if (!STAGES.includes(overStage as Stage)) return;

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage === overStage) return;

    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage: overStage as Stage } : d)));
    try {
      await api<Deal>(`/deals/${dealId}`, { method: "PATCH", body: JSON.stringify({ stage: overStage }) });
    } catch {
      await load();
    }
  }

  async function createDeal(payload: DealCreate) {
    const created = await api<Deal>("/deals", { method: "POST", body: JSON.stringify(payload) });
    setDeals((prev) => [created, ...prev]);
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Pipeline</div>
          <div className="muted">Track deals by stage.</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setCreateOpen(true)}>
            + New Deal
          </button>
          <button className="btn ghost" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="muted">Loading pipeline...</div> : null}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="kanban">
          {STAGES.map((st) => (
            <StageColumn key={st} stage={st} label={stageLabel(st)} count={byStage.get(st)?.length ?? 0}>
              {(byStage.get(st) ?? []).map((deal) => (
                <DraggableDeal key={deal.id} deal={deal} />
              ))}
            </StageColumn>
          ))}
        </div>
      </DndContext>

      <Modal title="Create Deal" open={createOpen} onClose={() => setCreateOpen(false)}>
        <CreateDealForm
          contacts={contacts}
          onCreate={async (payload) => {
            await createDeal(payload);
            setCreateOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}

function StageColumn({
  stage,
  label,
  count,
  children
}: {
  stage: Stage;
  label: string;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div className="col" ref={setNodeRef} style={isOver ? { outline: "2px solid rgba(138,180,255,0.5)" } : undefined}>
      <div className="colHeader">
        <div className="colTitle">{label}</div>
        <div className="count">{count}</div>
      </div>
      <div className="colBody">{children}</div>
    </div>
  );
}

function DraggableDeal({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.7 : 1
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <DealCard deal={deal} />
    </div>
  );
}

function CreateDealForm({ onCreate, contacts }: { onCreate: (payload: DealCreate) => Promise<void>; contacts: Contact[] }) {
  const [title, setTitle] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("residential");
  const [ticketSize, setTicketSize] = useState("");
  const [customerBudget, setCustomerBudget] = useState("");
  const [city, setCity] = useState("Pune");
  const [area, setArea] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [typology, setTypology] = useState("");
  const [clientPhase, setClientPhase] = useState<Deal["client_phase"]>("");
  const [stage, setStage] = useState<Stage>("lead");
  const [contactId, setContactId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const canSubmit = title.trim().length > 2 && !busy;

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setBusy(true);
        try {
          await onCreate({
            title: title.trim(),
            asset_type: assetType,
            stage,
            city,
            area,
            visit_date: visitDate || null,
            typology: typology.trim(),
            contact_id: contactId || null,
            ticket_size: ticketSize ? Number(ticketSize) : null,
            customer_budget: customerBudget ? Number(customerBudget) : null,
            client_phase: clientPhase || ""
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Client name, asset type, and market" />
      </label>
      <div className="grid2">
        <label>
          Asset Type
          <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
            <option value="land">Land</option>
            <option value="industrial">Industrial</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Stage
          <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid2">
        <label>
          City
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label>
          Area
          <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Baner, Wakad, Hinjewadi, BKC..." />
        </label>
      </div>
      <div className="grid2">
        <label>
          Date of visit
          <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
        </label>
        <label>
          Typology
          <input value={typology} onChange={(e) => setTypology(e.target.value)} placeholder="2 BHK, 4 BHK, penthouse, 2 acres land" />
        </label>
      </div>
      <label>
        Related Contact
        <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">None selected</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.role})
            </option>
          ))}
        </select>
      </label>
      <label>
        Ticket Size (Rs)
        <input inputMode="numeric" value={ticketSize} onChange={(e) => setTicketSize(e.target.value)} placeholder="9500000" />
      </label>
      <div className="grid2">
        <label>
          Customer Budget (Rs)
          <input inputMode="numeric" value={customerBudget} onChange={(e) => setCustomerBudget(e.target.value)} placeholder="8000000" />
        </label>
        <label>
          Client phase
          <select value={clientPhase} onChange={(e) => setClientPhase(e.target.value as Deal["client_phase"])}>
            <option value="">Select phase</option>
            <option value="hot">Hot - payment can happen soon</option>
            <option value="warm">Warm - interested and engaged</option>
            <option value="cold">Cold - visited but less interested</option>
            <option value="lost">Lost - no longer active</option>
          </select>
        </label>
      </div>
      <div className="row right">
        <button className="btn" disabled={!canSubmit} type="submit">
          {busy ? "Creating..." : "Create deal"}
        </button>
      </div>
    </form>
  );
}
