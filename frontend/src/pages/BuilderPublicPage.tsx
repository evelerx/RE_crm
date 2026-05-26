import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";

type BuilderSiteProperty = {
  id: string;
  title: string;
  property_type: string;
  address: string;
  city: string;
  area: string;
  price_label: string;
  description: string;
  image_urls: string[];
};

type BuilderSite = {
  slug: string;
  status: string;
  template_key: string;
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
  properties: BuilderSiteProperty[];
};

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function BuilderPublicPage() {
  const { slug = "" } = useParams();
  const [site, setSite] = useState<BuilderSite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await api<BuilderSite>(`/public/builder-sites/${encodeURIComponent(slug)}`);
        if (!cancelled) setSite(row);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Builder website not found");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const serviceAreas = useMemo(() => splitList(site?.service_areas || ""), [site?.service_areas]);
  const propertyTypes = useMemo(() => splitList(site?.property_types || ""), [site?.property_types]);
  const whatsappHref = site?.contact_whatsapp ? `https://wa.me/${site.contact_whatsapp.replace(/[^\d]/g, "")}` : "";

  if (loading) {
    return <div className="builderSiteShell"><div className="muted">Loading builder website...</div></div>;
  }

  if (!site || error) {
    return (
      <div className="builderSiteShell">
        <div className="builderSiteEmpty">
          <h1>Builder website unavailable</h1>
          <p>{error || "This builder has not published their website yet."}</p>
          <a className="btn" href="https://northstonecrm.com">Back to Northstone</a>
        </div>
      </div>
    );
  }

  return (
    <div className={`builderSiteShell builderTemplate-${site.template_key}`}>
      <header className="builderSiteHeader">
        <a className="builderSiteBrand" href={`/builders/${site.slug}`}>
          {site.logo_url ? <img src={site.logo_url} alt={`${site.site_name} logo`} /> : null}
          <span>{site.site_name}</span>
        </a>
        <nav>
          <a href="#properties">Properties</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>

      <main>
        <section className="builderHero">
          {site.hero_image_url ? <img src={site.hero_image_url} alt={`${site.site_name} project showcase`} /> : null}
          <div className="builderHeroCopy">
            <h1>{site.site_name}</h1>
            <p>{site.tagline || "Builder projects, locations, and contact details in one place."}</p>
            <div className="builderHeroActions">
              <a className="btn" href="#contact">Enquire now</a>
              {whatsappHref ? <a className="btn ghost" href={whatsappHref} target="_blank" rel="noreferrer">WhatsApp</a> : null}
            </div>
          </div>
        </section>

        <section className="builderBand">
          <div>
            <h2>About</h2>
            <p>{site.about_text || `${site.site_name} works across selected real-estate projects and builder-led opportunities.`}</p>
          </div>
          <div className="builderFactGrid">
            <div><b>Areas</b><span>{serviceAreas.length ? serviceAreas.join(", ") : "Contact office"}</span></div>
            <div><b>Property focus</b><span>{propertyTypes.length ? propertyTypes.join(", ") : "Residential and commercial"}</span></div>
            <div><b>Office</b><span>{[site.office_address, site.office_city, site.office_state, site.office_pincode].filter(Boolean).join(", ") || "Address available on request"}</span></div>
          </div>
        </section>

        <section id="properties" className="builderBand">
          <div className="builderSectionHead">
            <h2>Properties</h2>
            <p>{site.properties.length} listed project{site.properties.length === 1 ? "" : "s"}</p>
          </div>
          <div className="builderPropertyGrid">
            {site.properties.map((property) => (
              <article key={property.id} className="builderPropertyCard">
                {property.image_urls[0] ? <img src={property.image_urls[0]} alt={property.title} /> : null}
                <div>
                  <div className="builderPropertyMeta">{property.property_type || "Property"}{property.price_label ? ` | ${property.price_label}` : ""}</div>
                  <h3>{property.title}</h3>
                  <p>{property.description || "Contact the builder for current availability and details."}</p>
                  <div className="muted small">{[property.address, property.area, property.city].filter(Boolean).join(", ")}</div>
                  {property.image_urls.length > 1 ? (
                    <div className="builderThumbs">
                      {property.image_urls.slice(1, 5).map((url, index) => (
                        <img key={`${property.id}-${index}`} src={url} alt={`${property.title} ${index + 2}`} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="contact" className="builderBand builderContactBand">
          <div>
            <h2>Contact {site.site_name}</h2>
            <p>{site.contact_phone || site.contact_whatsapp || site.contact_email}</p>
            <p>{[site.office_address, site.office_city, site.office_state, site.office_pincode].filter(Boolean).join(", ")}</p>
          </div>
          {site.formspree_endpoint ? (
            <form className="builderContactForm" action={site.formspree_endpoint} method="POST">
              <input name="name" placeholder="Your name" required />
              <input name="phone" placeholder="Phone number" required />
              <input name="email" type="email" placeholder="Email address" />
              <textarea name="message" placeholder="What are you looking for?" required />
              <input type="hidden" name="builder_site" value={site.site_name} />
              <button className="btn" type="submit">Send enquiry</button>
            </form>
          ) : (
            <div className="builderContactForm">
              <a className="btn" href={`mailto:${site.contact_email}`}>Email builder</a>
              {whatsappHref ? <a className="btn ghost" href={whatsappHref} target="_blank" rel="noreferrer">WhatsApp</a> : null}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
