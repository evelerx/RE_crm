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
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedOwnerId, setExpandedOwnerId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    full_name: "",
    phone: "",
    whatsapp: "",
    company: "",
    city: "",
  });

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const rows = await api<any[]>("/admin/users");
      setUsers(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load CRM users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  const topLevelUsers = useMemo(() => {
    const employeeMap = new Map<string, any[]>();
    for (const user of users) {
      if (user.enterprise_owner_id) {
        const existing = employeeMap.get(user.enterprise_owner_id) ?? [];
        existing.push(user);
        employeeMap.set(user.enterprise_owner_id, existing);
      }
    }

    const query = search.trim().toLowerCase();
    return users
      .filter((user) => !user.enterprise_owner_id)
      .filter((user) => {
        if (!query) return true;
        const ownText = [
          user.full_name,
          user.phone,
          user.whatsapp,
          user.email,
          user.company,
          user.city,
          user.plan,
        ]
          .join(" ")
          .toLowerCase();
        const employeeMatch = (employeeMap.get(user.id) ?? []).some((employee) =>
          [
            employee.full_name,
            employee.phone,
            employee.whatsapp,
            employee.email,
            employee.company,
            employee.city,
            employee.enterprise_member_role,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        );
        return ownText.includes(query) || employeeMatch;
      })
      .map((user) => ({
        ...user,
        employees: (employeeMap.get(user.id) ?? []).sort((a, b) => String(a.full_name || a.email).localeCompare(String(b.full_name || b.email))),
      }));
  }, [users, search]);

  function startEdit(user: {
    id: string;
    full_name?: string;
    phone?: string;
    whatsapp?: string;
    company?: string;
    city?: string;
  }) {
    setEditingUserId(user.id);
    setSaveMsg(null);
    setSaveErr(null);
    setDraft({
      full_name: user.full_name || "",
      phone: user.phone || "",
      whatsapp: user.whatsapp || "",
      company: user.company || "",
      city: user.city || "",
    });
  }

  function stopEdit() {
    setEditingUserId(null);
    setSaveMsg(null);
    setSaveErr(null);
  }

  async function saveUser(userId: string) {
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      await api(`/admin/users/${userId}/profile`, {
        method: "PUT",
        body: JSON.stringify({
          full_name: draft.full_name,
          phone: draft.phone || null,
          whatsapp: draft.whatsapp || null,
          company: draft.company,
          city: draft.city,
          areas_served: "",
          specialization: "",
          rera_id: "",
          pan: "",
          gstin: "",
          languages: "",
          bio: "",
        }),
      });
      setSaveMsg("Contact details updated.");
      await loadUsers();
      setEditingUserId(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Failed to update contact details");
    } finally {
      setSaving(false);
    }
  }

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
          <button className="btn ghost" onClick={() => void loadUsers()} type="button">Refresh</button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="muted">Loading CRM user contacts...</div> : null}
      {saveErr ? <div className="alert">{saveErr}</div> : null}
      {saveMsg ? <div className="alert ok">{saveMsg}</div> : null}

      {topLevelUsers.length ? (
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
                <th>Employees</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {topLevelUsers.map((user) => {
                const isOwner = !user.enterprise_owner_id && ["enterprise", "builder"].includes((user.plan || "").toLowerCase());
                const isExpanded = expandedOwnerId === user.id;
                const userType =
                  user.is_admin_account ? "Admin" :
                  isOwner ? "Subscription owner" :
                  ((user.plan || "free").toLowerCase() === "free" ? "Solo user" : user.plan);
                return (
                  <>
                    <tr key={user.id}>
                      <td className="tdTitle">{user.full_name || "-"}</td>
                      <td>{userType}</td>
                      <td>{user.phone || "-"}</td>
                      <td>{user.whatsapp || "-"}</td>
                      <td>{user.email || "-"}</td>
                      <td>{user.company || "-"}</td>
                      <td>{user.city || "-"}</td>
                      <td>
                        {isOwner ? (
                          <button
                            className="btn ghost"
                            type="button"
                            onClick={() => setExpandedOwnerId(isExpanded ? null : user.id)}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? "Hide employees" : `Show employees (${user.employee_count || 0})`}
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => startEdit({
                            id: user.id,
                            full_name: user.full_name,
                            phone: user.phone,
                            whatsapp: user.whatsapp,
                            company: user.company,
                            city: user.city,
                          })}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                    {editingUserId === user.id ? (
                      <tr key={`${user.id}-edit`}>
                        <td colSpan={9}>
                          <div className="card" style={{ margin: 0 }}>
                            <div className="cardTitle">Edit contact details</div>
                            <div className="formGrid two">
                              <label>
                                Full name
                                <input value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} />
                              </label>
                              <label>
                                Phone
                                <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                              </label>
                              <label>
                                WhatsApp
                                <input value={draft.whatsapp} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} />
                              </label>
                              <label>
                                Company
                                <input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
                              </label>
                              <label>
                                City
                                <input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
                              </label>
                            </div>
                            <div className="row">
                              <button className="btn" type="button" disabled={saving} onClick={() => void saveUser(user.id)}>
                                {saving ? "Saving..." : "Save"}
                              </button>
                              <button className="btn ghost" type="button" disabled={saving} onClick={stopEdit}>Cancel</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {isOwner && isExpanded ? (user.employees ?? []).map((employee: any) => (
                      <tr key={`${user.id}-${employee.id}`}>
                        <td className="tdTitle">{employee.full_name || "-"}</td>
                        <td>{employee.enterprise_member_role || "employee"}</td>
                        <td>{employee.phone || "-"}</td>
                        <td>{employee.whatsapp || "-"}</td>
                        <td>{employee.email || "-"}</td>
                        <td>{employee.company || user.company || "-"}</td>
                        <td>{employee.city || user.city || "-"}</td>
                        <td>-</td>
                        <td>
                          <button
                            className="btn ghost"
                            type="button"
                            onClick={() => startEdit({
                              id: employee.id,
                              full_name: employee.full_name,
                              phone: employee.phone,
                              whatsapp: employee.whatsapp,
                              company: employee.company,
                              city: employee.city,
                            })}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    )) : null}
                    {isOwner && isExpanded && !(user.employees?.length) ? (
                      <tr key={`${user.id}-empty`}>
                        <td colSpan={9} className="muted">No employee contact details found for this subscription owner.</td>
                      </tr>
                    ) : null}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="muted">No CRM user contact details found for the current search.</div>
      )}
    </div>
  );
}
