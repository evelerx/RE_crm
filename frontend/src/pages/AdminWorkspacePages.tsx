import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

type EnterpriseDetail = {
  enterprise_owner_id: string;
  owner_email: string;
  owner_full_name: string;
  owner_phone: string;
  owner_whatsapp: string;
  company: string;
  company_city: string;
  owner_areas_served: string;
  owner_specialization: string;
  owner_has_rera_id: boolean;
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
    areas_served: string;
    specialization: string;
    has_rera_id: boolean;
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

type AdminUserRow = {
  id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  company?: string | null;
  city?: string | null;
  plan?: string | null;
  enterprise_owner_id?: string | null;
  enterprise_member_role?: string | null;
  employee_count?: number;
  is_admin_account?: boolean;
};

type AdminContactRow = AdminUserRow & {
  employees: AdminUserRow[];
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

function textValue(value: string | null | undefined) {
  return value ?? "";
}

const ADMIN_PIPELINE_STAGES = [
  { key: "new_lead", label: "New lead" },
  { key: "qualified", label: "Qualified" },
  { key: "active", label: "Active" },
  { key: "closed", label: "Closed" },
  { key: "lost", label: "Lost" }
] as const;

type AdminPipelineStageKey = (typeof ADMIN_PIPELINE_STAGES)[number]["key"];

function useAdminEnterpriseWorkspaces() {
  const [owners, setOwners] = useState<EnterpriseDetail[]>([]);
  const [workspaces, setWorkspaces] = useState<OwnerWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const enterpriseRows = await api<EnterpriseDetail[]>("/admin/enterprises");
      setOwners(enterpriseRows);
      const workspaceRows = await Promise.all(
        enterpriseRows.map((owner) => api<OwnerWorkspace>(`/admin/enterprises/${owner.enterprise_owner_id}/workspace`))
      );
      setWorkspaces(workspaceRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin enterprise workspace data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return {
    owners,
    workspaces,
    loading,
    error,
    reload: load,
  };
}

export function AdminOwnerPipelinePage() {
  const { owners, workspaces, loading, error, reload } = useAdminEnterpriseWorkspaces();
  const [search, setSearch] = useState("");
  const [expandedOwnerId, setExpandedOwnerId] = useState<string | null>(null);
  const [revealedReraByUserId, setRevealedReraByUserId] = useState<Record<string, string>>({});
  const [reraError, setReraError] = useState<string | null>(null);
  const [revealingUserId, setRevealingUserId] = useState<string | null>(null);

  const stageLabelByKey = useMemo(
    () =>
      new Map(
        ADMIN_PIPELINE_STAGES.map((stage) => [stage.key, stage.label])
      ),
    []
  );

  function deriveOwnerStage(stageCounts: OwnerPipelineStageCounts): AdminPipelineStageKey {
    const ordered: AdminPipelineStageKey[] = ["active", "qualified", "new_lead", "closed", "lost"];
    let best: AdminPipelineStageKey = "new_lead";
    let bestCount = -1;
    for (const stage of ordered) {
      const count = Number(stageCounts?.[stage] || 0);
      if (count > bestCount) {
        best = stage;
        bestCount = count;
      }
    }
    return best;
  }

  const ownerRows = useMemo(() => {
    const workspaceByOwnerId = new Map(workspaces.map((workspace) => [workspace.enterprise_owner_id, workspace]));
    const rows = owners.map((owner) => {
      const workspace = workspaceByOwnerId.get(owner.enterprise_owner_id);
      const stageCounts = workspace?.pipeline?.stage_counts ?? {
        new_lead: 0,
        qualified: 0,
        active: 0,
        closed: 0,
        lost: 0,
      };
      const stage = deriveOwnerStage(stageCounts);
      return {
        id: owner.enterprise_owner_id,
        stage,
        owner_name: owner.owner_full_name || owner.owner_email,
        owner_email: owner.owner_email,
        company: owner.company || "-",
        areas_served: owner.owner_areas_served || "-",
        specialization: owner.owner_specialization || "-",
        has_rera_id: Boolean(owner.owner_has_rera_id),
        employee_count: owner.employee_count || 0,
        employees: owner.employees ?? [],
      };
    });

    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      const ownText = [
        row.owner_name,
        row.owner_email,
        row.company,
        row.areas_served,
        row.specialization,
        stageLabelByKey.get(row.stage) || row.stage,
      ]
        .join(" ")
        .toLowerCase();
      const employeeText = row.employees
        .map((employee) =>
          [
            employee.full_name,
            employee.email,
            employee.company,
            employee.city,
            employee.areas_served,
            employee.specialization,
            employee.role_label,
          ]
            .join(" ")
            .toLowerCase()
        )
        .join(" ");
      return ownText.includes(query) || employeeText.includes(query);
    });
  }, [owners, search, stageLabelByKey, workspaces]);

  const stageCounts = useMemo(() => {
    return ADMIN_PIPELINE_STAGES.reduce<Record<AdminPipelineStageKey, number>>((acc, stage) => {
      acc[stage.key] = ownerRows.filter((row) => row.stage === stage.key).length;
      return acc;
    }, {
      new_lead: 0,
      qualified: 0,
      active: 0,
      closed: 0,
      lost: 0,
    });
  }, [ownerRows]);

  async function revealRera(userId: string, email: string) {
    const password = window.prompt(`Enter admin password to reveal the RERA ID for ${email}`);
    if (!password) return;
    setRevealingUserId(userId);
    setReraError(null);
    try {
      const response = await api<{ rera_id: string }>(`/admin/users/${userId}/reveal-rera`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setRevealedReraByUserId((current) => ({ ...current, [userId]: response.rera_id || "" }));
    } catch (e) {
      setReraError(e instanceof Error ? e.message : "Failed to reveal RERA ID");
    } finally {
      setRevealingUserId(null);
    }
  }

  function hideRera(userId: string) {
    setRevealedReraByUserId((current) => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Pipeline</div>
          <div className="muted">Stage-wise oversight for subscription owners only. Admin can review owner details, service areas, property focus, and protected RERA IDs without exposing client data.</div>
        </div>
        <div className="row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search owners and employees"
            aria-label="Search owners and employees"
            style={{ minWidth: 260 }}
          />
          <button className="btn ghost" onClick={() => void reload()} type="button">
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="muted">Loading admin pipeline...</div> : null}
      {reraError ? <div className="alert">{reraError}</div> : null}

      <div className="kanban" style={{ marginBottom: 16 }}>
        {ADMIN_PIPELINE_STAGES.map((stage) => (
          <div className="stageCard" key={stage.key}>
            <div className="stageTitle">{stage.label}</div>
            <div className="stageCount">{stageCounts[stage.key]}</div>
          </div>
        ))}
      </div>

      <div className="tableWrap tableWrapWide">
        <table className="table tableWide">
          <thead>
            <tr>
              <th>Owner name</th>
              <th>Stage</th>
              <th>Company</th>
              <th>Areas served</th>
              <th>Property types</th>
              <th>RERA ID</th>
              <th>Employees</th>
            </tr>
          </thead>
          <tbody>
            {ownerRows.length ? (
              ADMIN_PIPELINE_STAGES.map((stage) => {
                const stageRows = ownerRows.filter((row) => row.stage === stage.key);
                if (!stageRows.length) return null;
                return (
                  <Fragment key={stage.key}>
                    {stageRows.map((row) => {
                      const isExpanded = expandedOwnerId === row.id;
                      const revealedRera = revealedReraByUserId[row.id];
                      return (
                        <Fragment key={row.id}>
                          <tr key={row.id}>
                            <td className="tdTitle">{row.owner_name}</td>
                            <td>{stageLabelByKey.get(row.stage) || row.stage}</td>
                            <td>{row.company}</td>
                            <td>{row.areas_served}</td>
                            <td>{row.specialization}</td>
                            <td>
                              {!row.has_rera_id ? (
                                "-"
                              ) : revealedRera ? (
                                <div className="row">
                                  <span>{revealedRera}</span>
                                  <button className="btn ghost" type="button" onClick={() => hideRera(row.id)}>
                                    Hide
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="btn ghost"
                                  type="button"
                                  disabled={revealingUserId === row.id}
                                  onClick={() => void revealRera(row.id, row.owner_email)}
                                >
                                  {revealingUserId === row.id ? "Checking..." : "Show RERA"}
                                </button>
                              )}
                            </td>
                            <td>
                              <button
                                className="btn ghost"
                                type="button"
                                onClick={() => setExpandedOwnerId(isExpanded ? null : row.id)}
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? "Hide employees" : `Show employees (${row.employee_count})`}
                              </button>
                            </td>
                          </tr>
                          {isExpanded ? row.employees.map((employee) => {
                            const employeeRera = revealedReraByUserId[employee.id];
                            return (
                              <tr key={`${row.id}-${employee.id}`}>
                                <td className="tdTitle">{employee.full_name || employee.email}</td>
                                <td>{employee.role_label || "employee"}</td>
                                <td>{employee.company || row.company}</td>
                                <td>{employee.areas_served || "-"}</td>
                                <td>{employee.specialization || "-"}</td>
                                <td>
                                  {!employee.has_rera_id ? (
                                    "-"
                                  ) : employeeRera ? (
                                    <div className="row">
                                      <span>{employeeRera}</span>
                                      <button className="btn ghost" type="button" onClick={() => hideRera(employee.id)}>
                                        Hide
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      className="btn ghost"
                                      type="button"
                                      disabled={revealingUserId === employee.id}
                                      onClick={() => void revealRera(employee.id, employee.email)}
                                    >
                                      {revealingUserId === employee.id ? "Checking..." : "Show RERA"}
                                    </button>
                                  )}
                                </td>
                                <td>-</td>
                              </tr>
                            );
                          }) : null}
                          {isExpanded && !row.employees.length ? (
                            <tr key={`${row.id}-empty`}>
                              <td colSpan={7} className="muted">
                                No employee details linked to this subscription owner.
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="muted">No subscription-owner pipeline records found for the current search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminOwnerDealsPage() {
  const { owners, workspaces, loading, error, reload } = useAdminEnterpriseWorkspaces();
  const [search, setSearch] = useState("");

  const ownerMetaById = useMemo(
    () =>
      new Map(
        owners.map((owner) => [
          owner.enterprise_owner_id,
          {
            owner_email: owner.owner_email,
            owner_name: owner.owner_full_name || owner.owner_email,
            company: owner.company || "-",
          },
        ])
      ),
    [owners]
  );

  const dealRows = useMemo(() => {
    const rows = workspaces.flatMap((workspace) =>
      (workspace.deals ?? []).map((deal) => {
        const ownerMeta = ownerMetaById.get(workspace.enterprise_owner_id);
        return {
          ...deal,
          owner_email: ownerMeta?.owner_email || "-",
          owner_name: ownerMeta?.owner_name || "-",
          owner_company: ownerMeta?.company || "-",
        };
      })
    );

    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((deal) =>
      [
        deal.title,
        deal.stage,
        deal.asset_type,
        deal.city,
        deal.area,
        deal.typology,
        deal.owner_email,
        deal.owner_name,
        deal.owner_company,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [ownerMetaById, search, workspaces]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Deals</div>
          <div className="muted">All subscription-owner deal records visible to admin in one searchable table.</div>
        </div>
        <div className="row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deals"
            aria-label="Search deals"
            style={{ minWidth: 260 }}
          />
          <button className="btn ghost" onClick={() => void reload()} type="button">Refresh</button>
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
              <th>Owner</th>
              <th>Company</th>
              <th>Ticket size</th>
              <th>Client budget</th>
              <th>Close %</th>
              <th>Last activity</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {dealRows.map((deal) => (
              <tr key={deal.id}>
                <td className="tdTitle">{deal.title}</td>
                <td>{deal.stage}</td>
                <td>{deal.asset_type || "-"}</td>
                <td>{[deal.area, deal.city].filter(Boolean).join(", ") || "-"}</td>
                <td>{deal.typology || "-"}</td>
                <td>{deal.owner_name}</td>
                <td>{deal.owner_company}</td>
                <td>{formatRupees(deal.ticket_size)}</td>
                <td>{formatRupees(deal.customer_budget)}</td>
                <td>{deal.close_probability != null ? `${deal.close_probability}%` : "-"}</td>
                <td>{fmtDt(deal.last_activity_at)}</td>
                <td>{fmtDt(deal.updated_at)}</td>
              </tr>
            ))}
            {!dealRows.length ? (
              <tr>
                <td colSpan={12} className="muted">No deal records found for the current search.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminOwnerContactsPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
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
      const rows = await api<AdminUserRow[]>("/admin/users");
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
    const employeeMap = new Map<string, AdminUserRow[]>();
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
      .map<AdminContactRow>((user) => ({
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

  async function deleteUserProfile(user: { id: string; email?: string }) {
    const confirmed = window.confirm(`Clear saved contact details for ${user.email || "this user"}?`);
    if (!confirmed) return;
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      await api(`/admin/users/${user.id}/profile`, {
        method: "DELETE",
      });
      setSaveMsg("Contact details cleared.");
      await loadUsers();
      if (editingUserId === user.id) setEditingUserId(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Failed to clear contact details");
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
                        <div className="row">
                          <button
                            className="btn ghost"
                            type="button"
                            onClick={() => startEdit({
                              id: user.id,
                              full_name: textValue(user.full_name),
                              phone: textValue(user.phone),
                              whatsapp: textValue(user.whatsapp),
                              company: textValue(user.company),
                              city: textValue(user.city),
                            })}
                          >
                            Edit
                          </button>
                          <button
                            className="btn ghost"
                            type="button"
                            disabled={saving}
                            onClick={() => void deleteUserProfile({ id: user.id, email: user.email })}
                          >
                            Delete
                          </button>
                        </div>
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
                    {isOwner && isExpanded ? user.employees.map((employee) => (
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
                          <div className="row">
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => startEdit({
                                id: employee.id,
                                full_name: textValue(employee.full_name),
                                phone: textValue(employee.phone),
                                whatsapp: textValue(employee.whatsapp),
                                company: textValue(employee.company),
                                city: textValue(employee.city),
                              })}
                            >
                              Edit
                            </button>
                            <button
                              className="btn ghost"
                              type="button"
                              disabled={saving}
                              onClick={() => void deleteUserProfile({ id: employee.id, email: employee.email })}
                            >
                              Delete
                            </button>
                          </div>
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
