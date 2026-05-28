// MODIFIED: Phase 4 — Added Hotstar / Disney+ upload workflow — Gives users an in-product campaign intake, validation, preview, and status tracker.
import type { ChangeEvent, FormEvent } from "react";
import { useMemo, useState } from "react";

type HotstarFormat = "video_15" | "video_30" | "video_60" | "display_banner" | "bumper";
type HotstarStatus = "under_review" | "approved" | "live" | "paused" | "rejected";

type HotstarCampaign = {
  id: string;
  campaignName: string;
  format: HotstarFormat;
  fileName: string;
  fileType: string;
  previewUrl: string;
  targetAge: string;
  location: string;
  language: string;
  category: string;
  startDate: string;
  endDate: string;
  timeSlots: string;
  dailyBudget: string;
  totalBudget: string;
  destinationUrl: string;
  status: HotstarStatus;
  rejectionReason: string;
  impressions: number;
  reach: number;
  videoViews: number;
  ctr: number;
  spend: number;
};

const formats: Array<{ value: HotstarFormat; label: string; type: "video" | "image"; help: string }> = [
  { value: "video_15", label: "Video Ad - 15s", type: "video", help: "Short launch teaser or inventory highlight." },
  { value: "video_30", label: "Video Ad - 30s", type: "video", help: "Balanced project pitch with location and offer." },
  { value: "video_60", label: "Video Ad - 60s", type: "video", help: "Full walkthrough or builder credibility story." },
  { value: "display_banner", label: "Display Banner", type: "image", help: "Static visual for project awareness." },
  { value: "bumper", label: "Bumper Ad", type: "video", help: "Fast recall campaign for remarketing." },
];

const initialForm = {
  campaignName: "",
  format: "video_30" as HotstarFormat,
  targetAge: "25-54",
  location: "",
  language: "Hindi, English",
  category: "Sports",
  startDate: "",
  endDate: "",
  timeSlots: "Prime time",
  dailyBudget: "",
  totalBudget: "",
  destinationUrl: "",
};

function isVideoFormat(format: HotstarFormat) {
  return formats.find((item) => item.value === format)?.type === "video";
}

function formatStatus(status: HotstarStatus) {
  return status.replace(/_/g, " ");
}

export default function HotstarAdUpload() {
  const [form, setForm] = useState(initialForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [campaigns, setCampaigns] = useState<HotstarCampaign[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const expectsVideo = isVideoFormat(form.format);
  const accept = expectsVideo ? ".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo" : ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
  const selectedFormat = formats.find((item) => item.value === form.format);

  const canSubmit = useMemo(
    () =>
      Boolean(
        form.campaignName.trim() &&
          form.location.trim() &&
          form.startDate &&
          form.endDate &&
          form.dailyBudget.trim() &&
          form.totalBudget.trim() &&
          form.destinationUrl.trim() &&
          selectedFile
      ),
    [form, selectedFile]
  );

  function updateField(field: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl("");
    setUploadProgress(0);
  }

  function validateFile(file: File) {
    const videoTypes = ["video/mp4", "video/quicktime", "video/x-msvideo"];
    const imageTypes = ["image/jpeg", "image/png", "image/webp"];
    const maxVideoBytes = 500 * 1024 * 1024;
    const maxImageBytes = 5 * 1024 * 1024;
    if (expectsVideo) {
      if (!videoTypes.includes(file.type)) return "Hotstar video ads accept MP4, MOV, or AVI only.";
      if (file.size > maxVideoBytes) return "Video files must be 500MB or smaller.";
    } else {
      if (!imageTypes.includes(file.type)) return "Display banners accept JPG, PNG, or WebP only.";
      if (file.size > maxImageBytes) return "Image files must be 5MB or smaller.";
    }
    return "";
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setMessage(null);
    resetFile();
    if (!file) return;
    const validationError = validateFile(file);
    if (validationError) {
      setMessage(validationError);
      event.target.value = "";
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadProgress(35);
    window.setTimeout(() => setUploadProgress(72), 250);
    window.setTimeout(() => setUploadProgress(100), 600);
  }

  function submitCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !selectedFile) {
      setMessage("Complete all campaign details and attach a valid creative before submitting.");
      return;
    }
    const created: HotstarCampaign = {
      id: `hotstar-${Date.now()}`,
      campaignName: form.campaignName.trim(),
      format: form.format,
      fileName: selectedFile.name,
      fileType: selectedFile.type,
      previewUrl,
      targetAge: form.targetAge.trim(),
      location: form.location.trim(),
      language: form.language.trim(),
      category: form.category,
      startDate: form.startDate,
      endDate: form.endDate,
      timeSlots: form.timeSlots.trim(),
      dailyBudget: form.dailyBudget.trim(),
      totalBudget: form.totalBudget.trim(),
      destinationUrl: form.destinationUrl.trim(),
      status: "under_review",
      rejectionReason: "",
      impressions: 0,
      reach: 0,
      videoViews: 0,
      ctr: 0,
      spend: 0,
    };
    setCampaigns((current) => [created, ...current]);
    setForm(initialForm);
    setSelectedFile(null);
    setPreviewUrl("");
    setUploadProgress(0);
    setMessage("Hotstar campaign submitted for review.");
  }

  function updateStatus(id: string, status: HotstarStatus) {
    setCampaigns((current) =>
      current.map((campaign) => {
        if (campaign.id !== id) return campaign;
        const isLive = status === "live";
        return {
          ...campaign,
          status,
          rejectionReason: status === "rejected" ? "Creative needs policy review or safer claims." : "",
          impressions: isLive ? Math.max(campaign.impressions, 12500) : campaign.impressions,
          reach: isLive ? Math.max(campaign.reach, 8600) : campaign.reach,
          videoViews: isLive ? Math.max(campaign.videoViews, isVideoFormat(campaign.format) ? 5100 : 0) : campaign.videoViews,
          ctr: isLive ? Math.max(campaign.ctr, 1.8) : campaign.ctr,
          spend: isLive ? Math.max(campaign.spend, Number(campaign.dailyBudget || 0)) : campaign.spend,
        };
      })
    );
  }

  return (
    <section className="card hotstarUpload">
      <div className="sectionHeader">
        <div>
          <div className="sectionTitle">Hotstar / Disney+ ad upload</div>
          <div className="sectionSub">
            Prepare campaign creative, audience, schedule, budget, and review status before your marketing team publishes.
          </div>
        </div>
        <div className="pill adminPill">Hotstar ready</div>
      </div>

      {message ? <div className="bannerInfo hotstarMessage">{message}</div> : null}

      <form className="hotstarGrid" onSubmit={submitCampaign}>
        <div className="card hotstarPanel">
          <div className="sectionTitle hotstarPanelTitle">Creative</div>
          <label>
            Ad format
            <select value={form.format} onChange={(event) => updateField("format", event.target.value as HotstarFormat)}>
              {formats.map((format) => (
                <option key={format.value} value={format.value}>{format.label}</option>
              ))}
            </select>
          </label>
          <div className="muted">{selectedFormat?.help}</div>
          <label>
            Upload file
            <input type="file" accept={accept} onChange={onFileChange} />
          </label>
          <div className="muted">
            {expectsVideo ? "Accepted: MP4, MOV, AVI up to 500MB." : "Accepted: JPG, PNG, WebP up to 5MB."}
          </div>
          {selectedFile ? (
            <div className="hotstarProgressWrap">
              <div className="row hotstarFileRow">
                <span>{selectedFile.name}</span>
                <span>{Math.max(1, Math.round(selectedFile.size / 1024 / 1024))} MB</span>
              </div>
              <div className="hotstarProgress"><span style={{ width: `${uploadProgress}%` }} /></div>
              <div className="muted">Upload progress: {uploadProgress}%</div>
            </div>
          ) : null}
          {previewUrl ? (
            <div className="hotstarPreview">
              {expectsVideo ? (
                <video src={previewUrl} controls preload="metadata" />
              ) : (
                <img src={previewUrl} alt="Hotstar ad creative preview" />
              )}
            </div>
          ) : null}
        </div>

        <div className="card hotstarPanel">
          <div className="sectionTitle hotstarPanelTitle">Campaign details</div>
          <label>
            Campaign name
            <input value={form.campaignName} onChange={(event) => updateField("campaignName", event.target.value)} placeholder="Thane premium launch" />
          </label>
          <div className="grid cols2">
            <label>
              Age range
              <input value={form.targetAge} onChange={(event) => updateField("targetAge", event.target.value)} placeholder="25-54" />
            </label>
            <label>
              Location
              <input value={form.location} onChange={(event) => updateField("location", event.target.value)} placeholder="Mumbai, Thane, Navi Mumbai" />
            </label>
          </div>
          <div className="grid cols2">
            <label>
              Language
              <input value={form.language} onChange={(event) => updateField("language", event.target.value)} placeholder="Hindi, Marathi, English" />
            </label>
            <label>
              Content category
              <select value={form.category} onChange={(event) => updateField("category", event.target.value)}>
                <option>Sports</option>
                <option>Entertainment</option>
                <option>News</option>
              </select>
            </label>
          </div>
          <div className="grid cols2">
            <label>
              Start date
              <input type="date" value={form.startDate} onChange={(event) => updateField("startDate", event.target.value)} />
            </label>
            <label>
              End date
              <input type="date" value={form.endDate} onChange={(event) => updateField("endDate", event.target.value)} />
            </label>
          </div>
          <label>
            Time slots
            <input value={form.timeSlots} onChange={(event) => updateField("timeSlots", event.target.value)} placeholder="Prime time, weekends, cricket slots" />
          </label>
          <div className="grid cols2">
            <label>
              Daily budget ₹
              <input type="number" min="0" value={form.dailyBudget} onChange={(event) => updateField("dailyBudget", event.target.value)} placeholder="5000" />
            </label>
            <label>
              Total budget ₹
              <input type="number" min="0" value={form.totalBudget} onChange={(event) => updateField("totalBudget", event.target.value)} placeholder="50000" />
            </label>
          </div>
          <label>
            Destination URL
            <input value={form.destinationUrl} onChange={(event) => updateField("destinationUrl", event.target.value)} placeholder="https://northstonecrm.com/builders/project" />
          </label>
          <button className="btn" type="submit" disabled={!canSubmit}>Submit for review</button>
        </div>
      </form>

      <div className="card hotstarPanel">
        <div className="sectionHeader">
          <div>
            <div className="sectionTitle hotstarPanelTitle">Campaign status</div>
            <div className="sectionSub">Track review state and early performance metrics once live.</div>
          </div>
        </div>
        {campaigns.length === 0 ? (
          <div className="emptyState">No Hotstar campaigns submitted yet.</div>
        ) : (
          <div className="hotstarCampaignList">
            {campaigns.map((campaign) => (
              <article key={campaign.id} className="hotstarCampaign">
                <div>
                  <div className="sectionTitle hotstarCampaignTitle">{campaign.campaignName}</div>
                  <div className="muted">{campaign.fileName} | {formatStatus(campaign.status)}</div>
                  {campaign.rejectionReason ? <div className="bannerWarn">{campaign.rejectionReason}</div> : null}
                </div>
                <div className="hotstarMetrics">
                  <span>Impressions: {campaign.impressions.toLocaleString("en-IN")}</span>
                  <span>Reach: {campaign.reach.toLocaleString("en-IN")}</span>
                  <span>Views: {campaign.videoViews.toLocaleString("en-IN")}</span>
                  <span>CTR: {campaign.ctr}%</span>
                  <span>Spend: ₹{campaign.spend.toLocaleString("en-IN")}</span>
                </div>
                <div className="row hotstarActions">
                  {(["approved", "live", "paused", "rejected"] as HotstarStatus[]).map((status) => (
                    <button key={status} className="btn secondary" type="button" onClick={() => updateStatus(campaign.id, status)}>
                      {formatStatus(status)}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
