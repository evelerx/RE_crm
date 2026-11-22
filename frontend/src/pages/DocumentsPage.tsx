import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, apiBlob, apiForm } from "../api/client";

type DocumentRow = {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  name: string;
  category: string;
  content_type: string;
  size_bytes: number;
  file_url: string;
  uploaded_by_user_id: string;
  created_at: string;
};

type StorageStatus = {
  storage_limit_bytes: number;
  storage_used_bytes: number;
  storage_warning_bytes: number;
  upload_allowed: boolean;
};

const categories = ["general", "proposal", "agreement", "identity", "property", "payment", "marketing"];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [uploadCategory, setUploadCategory] = useState("general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    const [docs, status] = await Promise.all([
      api<DocumentRow[]>("/documents"),
      api<StorageStatus>("/governance/storage"),
    ]);
    setDocuments(docs);
    setStorage(status);
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load documents"));
  }, []);

  const visibleDocuments = useMemo(() => {
    const term = query.trim().toLowerCase();
    return documents.filter((item) => (category === "all" || item.category === category) && (!term || item.name.toLowerCase().includes(term)));
  }, [category, documents, query]);

  const usagePercent = storage ? Math.min(100, (storage.storage_used_bytes / storage.storage_limit_bytes) * 100) : 0;

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("category", uploadCategory);
      await apiForm<DocumentRow>("/documents", form);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload document");
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async (document: DocumentRow) => {
    setError(null);
    try {
      const blob = await apiBlob(`/documents/${document.id}/download`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open document");
    }
  };

  return (
    <div className="page docsPage">
      <div className="pageHeader">
        <div>
          <div className="eyebrow">Workspace files</div>
          <h1>Documents</h1>
          <p className="muted">Keep proposals, agreements, property papers, payment proofs, and marketing assets next to the CRM work they support.</p>
        </div>
        <div className="row">
          <select aria-label="Category for new upload" value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)}>
            {categories.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
          </select>
          <input ref={inputRef} type="file" hidden onChange={onPick} />
          <button className="btn" type="button" disabled={busy || storage?.upload_allowed === false} onClick={() => inputRef.current?.click()}>
            {busy ? "Uploading…" : "Upload document"}
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <section className="card docsStorageCard">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="cardTitle">Shared workspace storage</div>
            <div className="muted small">Files are visible to your workspace. Only the Manager can permanently delete them.</div>
          </div>
          <b>{storage ? `${formatBytes(storage.storage_used_bytes)} of ${Math.round(storage.storage_limit_bytes / (1024 * 1024 * 1024))} GB` : "Loading…"}</b>
        </div>
        <div className="docsMeter" aria-label={`Storage usage ${Math.round(usagePercent)} percent`}><span style={{ width: `${usagePercent}%` }} /></div>
        {storage && storage.storage_used_bytes >= storage.storage_warning_bytes ? <div className="alert">Storage notice: add storage before the included limit is reached.</div> : null}
      </section>

      <section className="card">
        <div className="docsToolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents" aria-label="Search documents" />
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter document category">
            <option value="all">All categories</option>
            {categories.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
          </select>
          <div className="muted small">{visibleDocuments.length} file{visibleDocuments.length === 1 ? "" : "s"}</div>
        </div>
        {visibleDocuments.length ? <div className="docsGrid">
          {visibleDocuments.map((document) => (
            <button className="docsItem" type="button" onClick={() => void openDocument(document)} key={document.id}>
              <div className="docsIcon">{document.category.slice(0, 2).toUpperCase()}</div>
              <div className="docsInfo">
                <b>{document.name}</b>
                <span>{document.category} · {formatBytes(document.size_bytes)}</span>
                <span>{new Date(document.created_at).toLocaleDateString()}</span>
              </div>
              <span className="docsOpen">Open ↗</span>
            </button>
          ))}
        </div> : <div className="emptyState">No documents match this view. Upload a file to begin your workspace library.</div>}
      </section>
    </div>
  );
}
