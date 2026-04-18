import { useEffect, useState } from "react";
import { api, apiBlob, apiForm } from "../api/client";
import type { Contact, ContactCreate } from "../api/types";
import Modal from "../components/Modal";

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
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  async function load() {
    setError(null);
    try {
      setContacts(await api<Contact[]>("/contacts"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
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
                  await apiForm<{ created: number }>("/csv/import/contacts", fd);
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
              </tr>
            ))}
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
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
    </div>
  );
}

function CreateContactForm({ onCreate }: { onCreate: (payload: ContactCreate) => Promise<void> }) {
  const [name, setName] = useState("");
  const [occupation, setOccupation] = useState("");
  const [role, setRole] = useState("buyer");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
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
          {busy ? "Saving..." : "Create contact"}
        </button>
      </div>
    </form>
  );
}
