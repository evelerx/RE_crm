import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

type BuilderWebsiteProperty = {
  id: string;
  title: string;
  property_type: string;
  address: string;
  city: string;
  area: string;
  price_label: string;
  description: string;
  image_urls: string[];
  sort_order: number;
};

type BuilderWebsite = {
  id: string;
  owner_id: string;
  slug: string;
  status: string;
  template_key: "signature_builder" | "project_launch" | "modern_realty";
  site_name: string;
  tagline: string;
  about_text: string;
  logo_url: string;
  hero_image_url: string;
  office_address: string;
  office_city: string;
  office_state: string;
  office_pincode: string;
  contact_email: string;
  contact_phone: string;
  contact_whatsapp: string;
  service_areas: string;
  property_types: string;
  formspree_endpoint: string;
  custom_domain: string;
  public_url: string;
  ai_key_name: string;
  ai_limit_usd: number;
  ai_ready: boolean;
  ai_last_error: string;
  properties: BuilderWebsiteProperty[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type BuilderWebsiteGenerateCopyResponse = {
  ok: boolean;
  tagline: string;
  about_text: string;
  ai_ready: boolean;
  ai_last_error: string;
};

type BuilderWebsiteForm = Omit<
  BuilderWebsite,
  "id" | "owner_id" | "status" | "public_url" | "ai_key_name" | "ai_limit_usd" | "ai_ready" | "ai_last_error" | "published_at" | "created_at" | "updated_at"
>;

const TEMPLATE_LABELS: Record<BuilderWebsite["template_key"], string> = {
  signature_builder: "Signature Builder",
  project_launch: "Project Launch",
  modern_realty: "Modern Realty"
};

function emptyProperty(): BuilderWebsiteProperty {
  return {
    id: `temp-${Math.random().toString(36).slice(2, 10)}`,
    title: "",
    property_type: "",
    address: "",
    city: "",
    area: "",
    price_label: "",
    description: "",
    image_urls: [],
    sort_order: 0
  };
}

function mapWebsiteToForm(website: BuilderWebsite): BuilderWebsiteForm {
  return {
    slug: website.slug,
    template_key: website.template_key,
    site_name: website.site_name,
    tagline: website.tagline,
    about_text: website.about_text,
    logo_url: website.logo_url,
    hero_image_url: website.hero_image_url,
    office_address: website.office_address,
    office_city: website.office_city,
    office_state: website.office_state,
    office_pincode: website.office_pincode,
    contact_email: website.contact_email,
    contact_phone: website.contact_phone,
    contact_whatsapp: website.contact_whatsapp,
    service_areas: website.service_areas,
    property_types: website.property_types,
    formspree_endpoint: website.formspree_endpoint,
    custom_domain: website.custom_domain,
    properties: website.properties.length ? website.properties : [emptyProperty()]
  };
}

function serializeWebsiteForm(form: BuilderWebsiteForm) {
  return JSON.stringify({
    ...form,
    properties: form.properties.map((property) => ({
      ...property,
      image_urls: [...property.image_urls]
    }))
  });
}

function apiProperties(properties: BuilderWebsiteProperty[]) {
  return properties
    .filter((item) => item.title.trim())
    .map((item, index) => ({
      title: item.title.trim(),
      property_type: item.property_type.trim(),
      address: item.address.trim(),
      city: item.city.trim(),
      area: item.area.trim(),
      price_label: item.price_label.trim(),
      description: item.description.trim(),
      image_urls: item.image_urls.map((url) => url.trim()).filter(Boolean),
      sort_order: index
    }));
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function validatePublishReady(form: BuilderWebsiteForm) {
  if (!form.site_name.trim()) return "Website name is required before publishing.";
  if (!form.contact_email.trim()) return "Contact email is required before publishing.";
  if (!form.about_text.trim()) return "Add a short builder description before publishing.";
  return "";
}

export default function BuilderWebsiteDesk() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [website, setWebsite] = useState<BuilderWebsite | null>(null);
  const [form, setForm] = useState<BuilderWebsiteForm | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const row = await api<BuilderWebsite>("/enterprise/builder-website");
      setWebsite(row);
      const nextForm = mapWebsiteToForm(row);
      setForm(nextForm);
      setSavedSnapshot(serializeWebsiteForm(nextForm));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load builder website desk");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const livePropertyCount = useMemo(() => form?.properties.filter((item) => item.title.trim()).length ?? 0, [form]);
  const hasUnsavedChanges = useMemo(
    () => (form ? serializeWebsiteForm(form) !== savedSnapshot : false),
    [form, savedSnapshot]
  );

  function scrollToPreview() {
    const element = document.getElementById("builder-website-preview");
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  async function saveWebsite() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const row = await api<BuilderWebsite>("/enterprise/builder-website", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          properties: apiProperties(form.properties)
        })
      });
      setWebsite(row);
      const nextForm = mapWebsiteToForm(row);
      setForm(nextForm);
      setSavedSnapshot(serializeWebsiteForm(nextForm));
      setMessage("Builder website draft saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save builder website");
    } finally {
      setBusy(false);
    }
  }

  async function publishWebsite() {
    if (!form) return;
    const publishError = validatePublishReady(form);
    if (publishError) {
      setMessage(null);
      setError(publishError);
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const savedRow = await api<BuilderWebsite>("/enterprise/builder-website", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          properties: apiProperties(form.properties)
        })
      });
      if (!savedRow.id) {
        throw new Error("Draft save did not return a valid website record.");
      }
      const row = await api<BuilderWebsite>("/enterprise/builder-website/publish", { method: "POST" });
      if (row.status !== "published") {
        throw new Error("Publish request completed, but the website is still marked as draft.");
      }
      setWebsite(row);
      const nextForm = mapWebsiteToForm(row);
      setForm(nextForm);
      setSavedSnapshot(serializeWebsiteForm(nextForm));
      setMessage(`Builder website published. Open the live page to review it: ${row.public_url}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish builder website");
    } finally {
      setBusy(false);
    }
  }

  async function unpublishWebsite() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const row = await api<BuilderWebsite>("/enterprise/builder-website/unpublish", { method: "POST" });
      setWebsite(row);
      const nextForm = mapWebsiteToForm(row);
      setForm(nextForm);
      setSavedSnapshot(serializeWebsiteForm(nextForm));
      setMessage("Builder website moved back to draft.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unpublish builder website");
    } finally {
      setBusy(false);
    }
  }

  async function generateStarterCopy() {
    if (!form) return;
    setAiBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api<BuilderWebsiteGenerateCopyResponse>("/enterprise/builder-website/generate-copy", {
        method: "POST",
        body: JSON.stringify({
          site_name: form.site_name,
          service_areas: form.service_areas,
          property_types: form.property_types,
          office_city: form.office_city,
          properties: apiProperties(form.properties)
        })
      });
      if (result.tagline || result.about_text) {
        setForm((prev) =>
          prev
            ? {
                ...prev,
                tagline: result.tagline || prev.tagline,
                about_text: result.about_text || prev.about_text
              }
            : prev
        );
        setMessage(
          result.ok
            ? result.ai_last_error
              ? `Starter copy generated. ${result.ai_last_error}`
              : "Starter copy generated."
            : result.ai_last_error || "AI copy is not ready yet."
        );
      } else {
        setMessage(result.ai_last_error || "AI copy is not ready yet.");
      }
      setWebsite((prev) =>
        prev
          ? {
              ...prev,
              ai_ready: result.ai_ready,
              ai_last_error: result.ai_last_error || ""
            }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate starter copy");
    } finally {
      setAiBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="card">
        <div className="cardTitle">Builder website desk</div>
        <div className="muted">Loading website builder...</div>
      </section>
    );
  }

  if (!form || !website) {
    return (
      <section className="card">
        <div className="cardTitle">Builder website desk</div>
        <div className="alert">{error || "Builder website desk is unavailable right now."}</div>
      </section>
    );
  }

  const isPublished = website.status === "published";

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="cardTitle" style={{ marginBottom: 4 }}>Builder website desk</div>
          <div className="muted">
            Publish a simple public builder website at <b>{website.public_url}</b>. Builders can later attach a custom domain
            after adding the DNS records shown by your registrar.
          </div>
        </div>
        <div className="pill enterprisePill">{website.status === "published" ? "Published" : "Draft"}</div>
      </div>

      {message ? <div className="alert ok">{message}</div> : null}
      {error ? <div className="alert">{error}</div> : null}

      <div className="statsGrid" style={{ marginBottom: 18 }}>
        <div className="statCard">
          <div className="statLabel">Public URL</div>
          <div className="statValue" style={{ fontSize: 18 }}>{website.public_url}</div>
          <div className="statHint">Auto-assigned on Northstone for every builder subscription.</div>
        </div>
        <div className="statCard">
          <div className="statLabel">Website AI key</div>
          <div className="statValue" style={{ fontSize: 18 }}>{website.ai_ready ? "Ready" : "Pending"}</div>
          <div className="statHint">
            {website.ai_key_name ? `${website.ai_key_name} | limit $${website.ai_limit_usd.toFixed(2)}` : `Auto-provisioned at $${website.ai_limit_usd.toFixed(2)} when management access is configured.`}
          </div>
        </div>
        <div className="statCard">
          <div className="statLabel">Properties listed</div>
          <div className="statValue">{livePropertyCount}</div>
          <div className="statHint">Every property gets its own address, copy, and image gallery.</div>
        </div>
      </div>

      {website.ai_last_error ? <div className="alert">{website.ai_last_error}</div> : null}
      {hasUnsavedChanges ? (
        <div className="alert ok" style={{ marginBottom: 18 }}>
          You have unsaved website edits. Save draft or publish website before leaving this page.
        </div>
      ) : null}
      {!isPublished ? (
        <div className="alert ok" style={{ marginBottom: 18 }}>
          This website is still in draft. The public URL will stay unavailable until you click <b>Publish website</b>. Use the preview section below to review the design before going live.
        </div>
      ) : null}

      <div className="grid2">
        <label>
          Template
          <select value={form.template_key} onChange={(e) => setForm((prev) => (prev ? { ...prev, template_key: e.target.value as BuilderWebsite["template_key"] } : prev))}>
            {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Company / site name
          <input value={form.site_name} onChange={(e) => setForm((prev) => (prev ? { ...prev, site_name: e.target.value } : prev))} />
        </label>
      </div>

      <div className="grid2">
        <label>
          Hero tagline
          <input value={form.tagline} onChange={(e) => setForm((prev) => (prev ? { ...prev, tagline: e.target.value } : prev))} placeholder="Built for trust, crafted for modern living." />
        </label>
        <label>
          Property types
          <input value={form.property_types} onChange={(e) => setForm((prev) => (prev ? { ...prev, property_types: e.target.value } : prev))} placeholder="Residential, luxury, plotted development" />
        </label>
      </div>

      <label>
        About the builder
        <textarea className="textarea" value={form.about_text} onChange={(e) => setForm((prev) => (prev ? { ...prev, about_text: e.target.value } : prev))} />
      </label>

      <div className="grid2">
        <label>
          Service areas
          <input value={form.service_areas} onChange={(e) => setForm((prev) => (prev ? { ...prev, service_areas: e.target.value } : prev))} placeholder="Thane, Powai, New Mumbai, Pune" />
        </label>
        <label>
          Formspree endpoint
          <input value={form.formspree_endpoint} onChange={(e) => setForm((prev) => (prev ? { ...prev, formspree_endpoint: e.target.value } : prev))} placeholder="https://formspree.io/f/..." />
        </label>
      </div>

      <div className="grid2">
        <label>
          Logo
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              try {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 2_000_000) {
                  setError("Logo must stay under 2 MB for the first builder website release.");
                  return;
                }
                const dataUrl = await fileToDataUrl(file);
                setError(null);
                setForm((prev) => (prev ? { ...prev, logo_url: dataUrl } : prev));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not read the selected logo.");
              }
            }}
          />
          {form.logo_url ? <img src={form.logo_url} alt="Builder logo preview" style={{ marginTop: 12, maxWidth: 120, borderRadius: 12 }} /> : null}
        </label>
        <label>
          Hero image
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              try {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 2_500_000) {
                  setError("Hero image must stay under 2.5 MB for the first builder website release.");
                  return;
                }
                const dataUrl = await fileToDataUrl(file);
                setError(null);
                setForm((prev) => (prev ? { ...prev, hero_image_url: dataUrl } : prev));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not read the selected hero image.");
              }
            }}
          />
          {form.hero_image_url ? <img src={form.hero_image_url} alt="Hero preview" style={{ marginTop: 12, width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 16 }} /> : null}
        </label>
      </div>

      <div className="grid2">
        <label>
          Contact email
          <input value={form.contact_email} onChange={(e) => setForm((prev) => (prev ? { ...prev, contact_email: e.target.value } : prev))} />
        </label>
        <label>
          Contact phone
          <input value={form.contact_phone} onChange={(e) => setForm((prev) => (prev ? { ...prev, contact_phone: e.target.value } : prev))} />
        </label>
      </div>

      <div className="grid2">
        <label>
          WhatsApp
          <input value={form.contact_whatsapp} onChange={(e) => setForm((prev) => (prev ? { ...prev, contact_whatsapp: e.target.value } : prev))} />
        </label>
        <label>
          Office address
          <input value={form.office_address} onChange={(e) => setForm((prev) => (prev ? { ...prev, office_address: e.target.value } : prev))} />
        </label>
      </div>

      <div className="grid2">
        <label>
          Office city
          <input value={form.office_city} onChange={(e) => setForm((prev) => (prev ? { ...prev, office_city: e.target.value } : prev))} />
        </label>
        <label>
          State / region
          <input value={form.office_state} onChange={(e) => setForm((prev) => (prev ? { ...prev, office_state: e.target.value } : prev))} />
        </label>
      </div>

      <div className="grid2">
        <label>
          Pincode
          <input value={form.office_pincode} onChange={(e) => setForm((prev) => (prev ? { ...prev, office_pincode: e.target.value } : prev))} />
        </label>
        <label>
          Custom domain
          <input value={form.custom_domain} onChange={(e) => setForm((prev) => (prev ? { ...prev, custom_domain: e.target.value.toLowerCase() } : prev))} placeholder="www.yourbuilderdomain.com" />
        </label>
      </div>

      <div className="alert ok" style={{ marginTop: 12 }}>
        Custom domain can be stored now. Live DNS binding stays a manual registrar step, so the safest first release is Northstone-hosted:
        <br />
        <b>{website.public_url}</b>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="cardTitle" style={{ marginBottom: 0 }}>Projects / properties</div>
          <button className="btn ghost" type="button" onClick={() => setForm((prev) => (prev ? { ...prev, properties: [...prev.properties, emptyProperty()] } : prev))}>
            Add property
          </button>
        </div>
        <div className="list">
          {form.properties.map((property, index) => (
            <div key={property.id || index} className="listItem">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <b>Property {index + 1}</b>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            properties: prev.properties.length === 1 ? [emptyProperty()] : prev.properties.filter((_, itemIndex) => itemIndex !== index)
                          }
                        : prev
                    )
                  }
                >
                  Remove
                </button>
              </div>
              <div className="grid2">
                <label>
                  Title
                  <input
                    value={property.title}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              properties: prev.properties.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, title: e.target.value } : item
                              )
                            }
                          : prev
                      )
                    }
                  />
                </label>
                <label>
                  Property type
                  <input
                    value={property.property_type}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              properties: prev.properties.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, property_type: e.target.value } : item
                              )
                            }
                          : prev
                      )
                    }
                  />
                </label>
              </div>
              <div className="grid2">
                <label>
                  Address
                  <input
                    value={property.address}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              properties: prev.properties.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, address: e.target.value } : item
                              )
                            }
                          : prev
                      )
                    }
                  />
                </label>
                <label>
                  Price label
                  <input
                    value={property.price_label}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              properties: prev.properties.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, price_label: e.target.value } : item
                              )
                            }
                          : prev
                      )
                    }
                    placeholder="From ₹1.4 Cr"
                  />
                </label>
              </div>
              <div className="grid2">
                <label>
                  City
                  <input
                    value={property.city}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              properties: prev.properties.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, city: e.target.value } : item
                              )
                            }
                          : prev
                      )
                    }
                  />
                </label>
                <label>
                  Area / locality
                  <input
                    value={property.area}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              properties: prev.properties.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, area: e.target.value } : item
                              )
                            }
                          : prev
                      )
                    }
                  />
                </label>
              </div>
              <label>
                Description
                <textarea
                  className="textarea"
                  value={property.description}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            properties: prev.properties.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, description: e.target.value } : item
                            )
                          }
                        : prev
                    )
                  }
                />
              </label>
              <label>
                Property gallery
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={async (e) => {
                    try {
                      const files = Array.from(e.target.files || []);
                      if (!files.length) return;
                      const oversize = files.find((file) => file.size > 2_500_000);
                      if (oversize) {
                        setError(`${oversize.name} is too large. Keep each property image under 2.5 MB.`);
                        return;
                      }
                      const urls = await Promise.all(files.map((file) => fileToDataUrl(file)));
                      setError(null);
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              properties: prev.properties.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, image_urls: [...item.image_urls, ...urls] } : item
                              )
                            }
                          : prev
                      );
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not read one of the selected property images.");
                    }
                  }}
                />
              </label>
              {property.image_urls.length ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginTop: 12 }}>
                  {property.image_urls.map((url, imageIndex) => (
                    <div key={`${property.id}-${imageIndex}`} className="mini">
                      <img src={url} alt={`${property.title || "Property"} ${imageIndex + 1}`} style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 12 }} />
                      <button
                        className="btn ghost"
                        type="button"
                        style={{ marginTop: 8 }}
                        onClick={() =>
                          setForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  properties: prev.properties.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, image_urls: item.image_urls.filter((_, currentIndex) => currentIndex !== imageIndex) }
                                      : item
                                  )
                                }
                              : prev
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="row" style={{ marginTop: 18, flexWrap: "wrap" }}>
        <button className="btn" type="button" onClick={() => void saveWebsite()} disabled={busy} title={busy ? "A website action is already running." : hasUnsavedChanges ? "Save your draft changes." : "No unsaved changes yet, but you can save the current draft again."}>
          {busy ? "Saving..." : "Save draft"}
        </button>
        <button className="btn ghost" type="button" onClick={() => void generateStarterCopy()} disabled={aiBusy} title={aiBusy ? "Starter copy is being generated right now." : "Generate draft copy for the headline and about section."}>
          {aiBusy ? "Generating..." : "Generate starter copy"}
        </button>
        <button className="btn ghost" type="button" onClick={() => void publishWebsite()} disabled={busy} title={busy ? "A website action is already running." : "Publish the current draft to the public builder page."}>
          Publish website
        </button>
        <button className="btn ghost" type="button" onClick={() => void unpublishWebsite()} disabled={busy || website.status !== "published"} title={website.status !== "published" ? "This website is still a draft, so there is nothing live to unpublish." : busy ? "A website action is already running." : "Move the live builder website back to draft."}>
          Unpublish
        </button>
        {isPublished ? (
          <a className="btn ghost" href={website.public_url} target="_blank" rel="noreferrer">
            View live page
          </a>
        ) : (
          <button className="btn ghost" type="button" onClick={scrollToPreview}>
            Preview draft
          </button>
        )}
      </div>

      <div className="card" id="builder-website-preview" style={{ marginTop: 18 }}>
        <div className="cardTitle">Preview</div>
        <div className={`enterprisePreviewCard ${form.template_key}`}>
          {form.hero_image_url ? (
            <div style={{ marginBottom: 18 }}>
              <img src={form.hero_image_url} alt={`${form.site_name} hero`} style={{ width: "100%", maxHeight: 280, objectFit: "cover", borderRadius: 18 }} />
            </div>
          ) : null}
          <div className="row" style={{ alignItems: "center", gap: 16, marginBottom: 16 }}>
            {form.logo_url ? <img src={form.logo_url} alt={`${form.site_name} logo`} style={{ width: 64, height: 64, borderRadius: 16, objectFit: "cover" }} /> : null}
            <div>
              <div className="h2" style={{ marginBottom: 4 }}>{form.site_name || "Builder company"}</div>
              <div className="muted">{form.tagline || "Your headline will appear here after publishing."}</div>
            </div>
          </div>
          <div className="grid2">
            <div className="mini">
              <b>About</b>
              <div className="muted" style={{ marginTop: 8 }}>{form.about_text || "Builder overview, trust points, and areas served will appear here."}</div>
            </div>
            <div className="mini">
              <b>Contact</b>
              <div className="muted" style={{ marginTop: 8 }}>
                {form.contact_email || "contact@example.com"}
                <br />
                {form.contact_phone || "Phone not set yet"}
                <br />
                {form.office_address || "Office address not set yet"}
                {form.office_city ? `, ${form.office_city}` : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
