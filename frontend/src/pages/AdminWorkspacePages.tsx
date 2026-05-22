import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

type EnterpriseDetail = {
  enterprise_owner_id: string;
  owner_email: string;
  owner_full_name: string;
  owner_phone: string;
  owner_whatsapp: string;
  company: string;
  company_city: string;
  employee_limit: number;
  employee_count: number;
  employees: {
    id: string;
    email: string;
    full_name: string;
    phone: string;
    whatsapp: string;
    company: string;
    city: string;
    role_label: string;
  }[];
};

type OwnerPipelineStageCounts = {
  new_lead: number;
  qualified: number;
  active: number;
  closed: number;
  lost: number;
};

type OwnerDealRow = {
  id: string;
  title: string;
  asset_type: string;
  stage: string;
  city: string;
  area: string;
  typology: string;
  ticket_size: number | null;
  customer_budget: number | null;
  close_probability: number | null;
  last_activity_at: string | null;
  updated_at: string;
};

type OwnerContactRow = {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  tags: string;
  updated_at: string;
};

type OwnerWorkspace = {
  enterprise_owner_id: string;
  pipeline: {
    total: number;
    stage_counts: OwnerPipelineStageCounts;
  };
  deals: OwnerDealRow[];
  contacts: OwnerContactRow[];
};

function fmtDt(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatRupees(value: number | null) {
  if (value == null) return "-";
  return `Rs ${Math.round(value).toLocaleString("en-IN")}`;
}

const ADMIN_PIPELINE_STAGES = [
  { key: "new_lead", label: "New lead" },
  { key: "qualified", label: "Qualified" },
  { key: "active", label: "Active" },
  { key: "closed", label: "Closed" },
  { key: "lost", label: "Lost" }
] as const;

type AdminPipelineStageKey = (typeof ADMIN_PIPELINE_STAGES)[number]["key"];

function useAdminWorkspaceData() {
  const [owners, setOwners] = useState<EnterpriseDetail[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState("");
  const [workspace, setWorkspace] = useState<OwnerWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(ownerIdOverride?: string) {
    setLoading(true);
    setError(null);
    try {
      const enterpriseRows = await api<EnterpriseDetail[]>("/admin/enterprises");
      setOwners(enterpriseRows);
      const nextOwnerId = ownerIdOverride || selectedOwnerId || enterpriseRows[0]?.enterprise_owner_id || "";
      setSelectedOwnerId(nextOwnerId);

      const nextWorkspace = nextOwnerId ? await api<OwnerWorkspace>(`/admin/enterprises/${nextOwnerId}/workspace`) : null;
      setWorkspace(nextWorkspace);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin workspace data");
    } finally {
      setLoading(false);
    }
  }

  async function selectOwner(nextOwnerId: string) {
    setSelectedOwnerId(nextOwnerId);
    setLoading(true);
    setError(null);
    try {
      const nextWorkspace = nextOwnerId ? await api<OwnerWorkspace>(`/admin/enterprises/${nextOwnerId}/workspace`) : null;
      setWorkspace(nextWorkspace);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load owner workspace");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    owners,
    selectedOwnerId,
    setSelectedOwnerId: selectOwner,
    workspace,
    loading,
    error,
    reload: load
  };
}

function OwnerSelector({
  owners,
  selectedOwnerId,
  onChange
}: {
  owners: EnterpriseDetail[];
  selectedOwnerId: string;
  onChange: (ownerId: string) => Promise<void> | void;
}) {
  return (
    <label>
      Subscription owner
      <select value={selectedOwnerId} onChange={(e) => void onChange(e.target.value)}>
        {owners.map((owner) => (
          <option key={owner.enterprise_owner_id} value={owner.enterprise_owner_id}>
            {owner.owner_email}
          </option>
        ))}
        {owners.length === 0 ? <option value="">No subscription owners yet</option> : null}
      </select>
    </label>
  );
}

export function AdminOwnerPipelinePage() {
  const { owners, selectedOwnerId, setSelectedOwnerId, workspace, loading, error, reload } = useAdminWorkspaceData();
  const stageMap = useMemo(() => {
    const map: Record<AdminPipelineStageKey, { id: string; title: string; subtitle: string; meta: string; kind: "deal" }[]> = {
      new_lead: [],
      qualified: [],
      active: [],
      closed: [],
      lost: []
    };

    return map;
  }, []);

  const stageCounts = workspace?.pipeline.stage_counts ?? {
    new_lead: 0,
    qualified: 0,
    active: 0,
    closed: 0,
    lost: 0
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Pipeline</div>
          <div className="muted">Admin tracking view for live subscription-owner pipeline counts.</div>
        </div>
        <div className="row">
          <OwnerSelector owners={owners} selectedOwnerId={selectedOwnerId} onChange={setSelectedOwnerId} />
          <button className="btn ghost" onClick={() => void reload()} type="button">
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="muted">Loading admin pipeline...</div> : null}

      <section className="card">
        <div className="cardTitle">Pipeline overview</div>
        <div className="mini" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <div>
            <b>Total live records:</b> {workspace?.pipeline.total ?? 0}
          </div>
          <div>
            <b>Source:</b> Subscription owner workspace
          </div>
          <div>
            <b>Admin usage:</b> Monitor live customer pipeline health by stage
          </div>
        </div>
      </section>

      <div className="kanban adminPipelineBoard">
        {ADMIN_PIPELINE_STAGES.map((stage) => {
          const cards = stageMap[stage.key] ?? [];
          return (
            <div
              key={stage.key}
              className="col adminSecondaryStage"
            >
              <div className="colHeader">
                <div className="colTitle">{stage.label}</div>
                <div className="count">{stageCounts[stage.key]}</div>
              </div>
              <div className="colBody">
                {cards.map((card) => (
                  <div key={card.id} className="dealCard adminIntakeCard" style={{ cursor: "default" }}>
                    <div className="dcTop">
                      <div className="dcTitle">{card.title}</div>
                      <div className="pill">live</div>
                    </div>
                    <div className="dcMeta">
                      <div className="muted">{card.subtitle || "-"}</div>
                    </div>
                    <div className="muted small">{card.meta || "-"}</div>
                  </div>
                ))}
                {!cards.length ? (
                  <div className="adminStagePlaceholder">
                    <div className="muted">No records</div>
                    <div className="small muted">
                      Live stage counts are shown above. Detailed deal movement stays inside the customer workspace.
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdminOwnerDealsPage() {
  const { owners, selectedOwnerId, setSelectedOwnerId, workspace, loading, error, reload } = useAdminWorkspaceData();

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Deals</div>
          <div className="muted">All subscription-owner deal records visible to admin for oversight.</div>
        </div>
        <div className="row">
          <OwnerSelector owners={owners} selectedOwnerId={selectedOwnerId} onChange={setSelectedOwnerId} />
          <button className="btn ghost" onClick={() => void reload(selectedOwnerId)} type="button">Refresh</button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="muted">Loading owner deals...</div> : null}

      <div className="tableWrap tableWrapWide">
        <table className="table tableWide">
          <thead>
            <tr>
              <th>Deal</th>
              <th>Stage</th>
              <th>Asset</th>
              <th>Location</th>
              <th>Typology</th>
              <th>Ticket size</th>
              <th>Client budget</th>
              <th>Close %</th>
              <th>Last activity</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {(workspace?.deals ?? []).map((deal) => (
              <tr key={deal.id}>
                <td className="tdTitle">{deal.title}</td>
                <td>{deal.stage}</td>
                <td>{deal.asset_type || "-"}</td>
                <td>{[deal.area, deal.city].filter(Boolean).join(", ") || "-"}</td>
                <td>{deal.typology || "-"}</td>
                <td>{formatRupees(deal.ticket_size)}</td>
                <td>{formatRupees(deal.customer_budget)}</td>
                <td>{deal.close_probability != null ? `${deal.close_probability}%` : "-"}</td>
                <td>{fmtDt(deal.last_activity_at)}</td>
                <td>{fmtDt(deal.updated_at)}</td>
              </tr>
            ))}
            {!(workspace?.deals.length) ? (
              <tr>
                <td colSpan={10} className="muted">No deal records found for this subscription owner.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminOwnerContactsPage() {
  const { owners, loading, error, reload } = useAdminWorkspaceData();
  const [search, setSearch] = useState("");

  const userRows = useMemo(() => {
    const rows = owners.flatMap((owner) => {
      const ownerRow = {
        id: `owner-${owner.enterprise_owner_id}`,
        full_name: owner.owner_full_name || "-",
        phone: owner.owner_phone || "-",
        whatsapp: owner.owner_whatsapp || "-",
        email: owner.owner_email || "-",
        company: owner.company || "-",
        city: owner.company_city || "-",
        user_type: "Subscription owner",
        subscription_owner: owner.owner_email || "-",
      };

      const employeeRows = (owner.employees ?? []).map((employee) => ({
        id: employee.id,
        full_name: employee.full_name || "-",
        phone: employee.phone || "-",
        whatsapp: employee.whatsapp || "-",
        email: employee.email || "-",
        company: employee.company || owner.company || "-",
        city: employee.city || owner.company_city || "-",
        user_type: employee.role_label || "employee",
        subscription_owner: owner.owner_email || "-",
      }));

      return [ownerRow, ...employeeRows];
    });

    const query = search.trim().toLowerCase();
    if (!query) return rows;

    return rows.filter((row) =>
      [
        row.full_name,
        row.phone,
        row.whatsapp,
        row.email,
        row.company,
        row.city,
        row.user_type,
        row.subscription_owner,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [owners, search]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Contacts</div>
          <div className="muted">All CRM user contact details visible to admin for account communication. Client contact data is excluded from this page.</div>
        </div>
        <div className="row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search owners and employees"
            aria-label="Search owners and employees"
            style={{ minWidth: 260 }}
          />
          <button className="btn ghost" onClick={() => void reload()} type="button">Refresh</button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="muted">Loading CRM user contacts...</div> : null}

      <div className="tableWrap tableWrapWide">
        <table className="table tableWide">
          <thead>
            <tr>
              <th>Name</th>
              <th>User type</th>
              <th>Phone</th>
              <th>WhatsApp</th>
              <th>Email</th>
              <th>Company</th>
              <th>City</th>
              <th>Subscription owner</th>
            </tr>
          </thead>
          <tbody>
            {userRows.length ? (
              userRows.map((row) => (
                <tr key={row.id}>
                  <td className="tdTitle">{row.full_name}</td>
                  <td>{row.user_type}</td>
                  <td>{row.phone}</td>
                  <td>{row.whatsapp}</td>
                  <td>{row.email}</td>
                  <td>{row.company}</td>
                  <td>{row.city}</td>
                  <td>{row.subscription_owner}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="muted">No CRM user contact details found for the current search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
