import { useEffect, useState } from "react";
import { api, apiBlob, apiForm, deleteContact as deleteContactRequest, getDefaultSequence, updateContact as updateContactRequest } from "../api/client";
import type { Contact, ContactCreate, ContactUpdate, FollowUpSequence } from "../api/types";
import Modal from "../components/Modal";

type CsvFailedRow = {
  row_number: number;
  column_name: string;
  error_reason: string;
  row: Record<string, string>;
};

type CsvImportResponse = {
  created: number;
  success_count: number;
  failed_count: number;
  failed_rows: CsvFailedRow[];
};

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sequence, setSequence] = useState<FollowUpSequence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [importSummary, setImportSummary] = useState<CsvImportResponse | null>(null);

  function downloadFailedRowsCsv(rows: CsvFailedRow[]) {
    const headers = ["row_number", "column_name", "error_reason"];
    const dynamicHeaders = Array.from(new Set(rows.flatMap((item) => Object.keys(item.row || {}))));
    const csv = [
      [...headers, ...dynamicHeaders].join(","),
      ...rows.map((item) =>
        [
          item.row_number,
          item.column_name,
          JSON.stringify(item.error_reason),
          ...dynamicHeaders.map((key) => JSON.stringify(item.row?.[key] ?? "")),
        ].join(","),
      ),
    ].join("\n");
    downloadBlob("failed_rows.csv", new Blob([csv], { type: "text/csv;charset=utf-8" }));
  }

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const [contactRows, sequenceRow] = await Promise.all([
        api<Contact[]>("/contacts"),
        getDefaultSequence(),
      ]);
      setContacts(contactRows);
      setSequence(sequenceRow);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Contacts</div>
          <div className="muted">Client and partner directory.</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setCreateOpen(true)} type="button">
            + New Contact
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={async () => {
              try {
                const blob = await apiBlob("/csv/export/contacts");
                downloadBlob("contacts.csv", blob);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Export failed");
              }
            }}
          >
            Export CSV
          </button>
          <label className="btn ghost" style={{ cursor: "pointer" }}>
            Import CSV/XLSX
            <input
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const fd = new FormData();
                  fd.append("file", file);
                  const result = await apiForm<CsvImportResponse>("/csv/import/contacts", fd);
                  setImportSummary(result);
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Import failed");
                } finally {
                  e.target.value = "";
                }
              }}
            />
          </label>
          <button className="btn ghost" onClick={() => void load()} type="button">
            Refresh
          </button>
        </div>
      </div>
      {error ? <div className="alert">{error}</div> : null}
      <section className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="cardTitle">Default saved sequence</div>
            <div className="muted">This is the follow-up sequence your team can use while working these contacts.</div>
          </div>
          <a className="btn ghost compact" href="/sequences">
            Open sequence
          </a>
        </div>
        {sequence ? (
          <div className="sequenceSteps" style={{ marginTop: 16 }}>
            {sequence.steps.map((step, index) => (
              <div key={step.id} className="sequenceStepCard">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div className="sequenceStepBadge">Step {index + 1}</div>
                  <span className="tag">{step.delay}</span>
                </div>
                <div className="tdTitle" style={{ marginTop: 10 }}>{step.subject}</div>
                <div className="muted" style={{ marginTop: 6 }}>{step.body}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 16 }}>No saved sequence yet.</div>
        )}
      </section>
      {importSummary ? (
        <div className={importSummary.failed_count > 0 ? "alert" : "alert ok"}>
          Imported {importSummary.success_count} records. {importSummary.failed_count} rows failed
          {importSummary.failed_count > 0 ? " — see details below." : "."}
          {importSummary.failed_count > 0 ? (
            <div style={{ marginTop: 12 }}>
              <button className="btn ghost" type="button" onClick={() => downloadFailedRowsCsv(importSummary.failed_rows)}>
                Download failed_rows.csv
              </button>
              <div className="list" style={{ marginTop: 10 }}>
                {importSummary.failed_rows.map((row) => (
                  <div key={`${row.row_number}-${row.column_name}`} className="listItem">
                    Row {row.row_number} · {row.column_name} · {row.error_reason}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th className="colName">Name</th>
              <th>Occupation</th>
              <th className="colRole">Purpose</th>
              <th className="colPhone">Phone</th>
              <th className="colEmail">Email</th>
              <th className="colTags">Feedback</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td className="colName">{c.name}</td>
                <td>{c.occupation || "-"}</td>
                <td className="colRole">{c.role}</td>
                <td className="colPhone">{c.phone ?? "-"}</td>
                <td className="colEmail">{c.email ?? "-"}</td>
                <td className="colTags">{c.tags || "-"}</td>
                <td>
                  <div className="row">
                    <button className="btn ghost compact" type="button" onClick={() => setEditingContact(c)}>
                      Edit
                    </button>
                    <button
                      className="btn ghost compact"
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`Delete contact "${c.name}"?`)) return;
                        try {
                          await deleteContactRequest(c.id);
                          setContacts((prev) => prev.filter((row) => row.id !== c.id));
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Delete failed");
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {loading ? (
              [1, 2, 3, 4, 5].map((i) => (
                <tr key={i}>
                  {[80, 55, 40, 50, 60, 45, 38].map((w, j) => (
                    <td key={j}><div className="skeletonBar" style={{ width: `${w}%` }} /></td>
                  ))}
                </tr>
              ))
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No contacts yet. Add your first one to start building deal relationships.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Modal title="Create Contact" open={createOpen} onClose={() => setCreateOpen(false)}>
        <CreateContactForm
          onCreate={async (payload) => {
            const created = await api<Contact>("/contacts", { method: "POST", body: JSON.stringify(payload) });
            setContacts((prev) => [created, ...prev]);
            setCreateOpen(false);
          }}
        />
      </Modal>

      <Modal title="Edit Contact" open={Boolean(editingContact)} onClose={() => setEditingContact(null)}>
        {editingContact ? (
          <CreateContactForm
            key={editingContact.id}
            initialValue={editingContact}
            submitLabel="Save changes"
            onCreate={async (payload) => {
              const updated = await updateContactRequest(editingContact.id, payload as ContactUpdate);
              setContacts((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
              setEditingContact(null);
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function CreateContactForm({
  onCreate,
  initialValue,
  submitLabel = "Create contact",
}: {
  onCreate: (payload: ContactCreate) => Promise<void>;
  initialValue?: Partial<Contact> | null;
  submitLabel?: string;
}) {
  const [name, setName] = useState(initialValue?.name ?? "");
  const [occupation, setOccupation] = useState(initialValue?.occupation ?? "");
  const [role, setRole] = useState(initialValue?.role ?? "buyer");
  const [phone, setPhone] = useState(initialValue?.phone ?? "");
  const [email, setEmail] = useState(initialValue?.email ?? "");
  const [tags, setTags] = useState(initialValue?.tags ?? "");
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const canSubmit = name.trim().length >= 2 && !busy;

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setBusy(true);
        try {
          await onCreate({
            name: name.trim(),
            occupation: occupation.trim(),
            role,
            phone: phone.trim() || null,
            email: email.trim() || null,
            tags: tags.trim(),
            notes: notes.trim()
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Client, owner, investor, or partner" />
      </label>
      <div className="grid2">
        <label>
          Occupation
          <input value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="Doctor, founder, investor, salaried" />
        </label>
        <label>
          Purpose
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="buyer">Buyer</option>
            <option value="seller">Seller</option>
            <option value="investor">Investor</option>
            <option value="tenant">Tenant</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <label>
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98XXXXXXXX" />
      </label>
      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      </label>
      <label>
        Feedback
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Hot, needs callback, liked inventory, budget mismatch" />
      </label>
      <label>
        Notes
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Budget, preferences, urgency, and follow-up context" />
      </label>
      <div className="row right">
        <button className="btn" disabled={!canSubmit} type="submit">
          {busy ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
