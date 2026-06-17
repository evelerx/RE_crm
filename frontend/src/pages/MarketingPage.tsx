// MODIFIED: Marketing portal live page — wires the prompt-style request wizard, subscriber workspace, comments, approvals, and notifications to the real marketing APIs.
import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import Modal from "../components/Modal";
import BillingPanel from "../components/marketing/BillingPanel";
import CampaignsTable from "../components/marketing/CampaignsTable";
import LeadFunnel from "../components/marketing/LeadFunnel";
import MessageCenter from "../components/marketing/MessageCenter";
import MetricsRow from "../components/marketing/MetricsRow";
import PendingApprovals from "../components/marketing/PendingApprovals";
import PhaseTracker from "../components/marketing/PhaseTracker";
import ReportsPanel from "../components/marketing/ReportsPanel";
import MarketingSidebar from "../components/marketing/Sidebar";
import TeamThread from "../components/marketing/TeamThread";
import MarketingTopBar from "../components/marketing/TopBar";
import { ToastProvider, useToast } from "../components/ToastProvider";
import {
  addMarketingComment,
  createMarketingRequest,
  getMarketingAddonStatus,
  getMarketingMetrics,
  getMarketingRequest,
  getMarketingWorkspace,
  listMarketingActivity,
  listMarketingNotifications,
  listMarketingRequests,
  markMarketingNotificationRead,
  ownerSignOffMarketingApproval,
} from "../api/client";
import type {
  Approval,
  Campaign,
  Comment,
  LeadFunnelMetrics,
  MarketingActivityLogEntry,
  MarketingAddonCatalogPlan,
  MarketingAddonStatusResponse,
  MarketingMetrics,
  MarketingNotification,
  MarketingRequestCreatePayload,
  MarketingRequestDetail,
  MarketingRequestSummary,
  MarketingWorkspaceAccess,
} from "../types/marketing";

type WizardFormState = {
  channel: string;
  objective: string;
  subscriptionPlan: string;
  marketingAddon: string;
  projectName: string;
  propertyType: string;
  targetCity: string;
  targetArea: string;
  priceRange: string;
  targetAudience: string;
  primaryGoal: string;
  leadTarget: string;
  launchDate: string;
  duration: string;
  monthlySpend: number;
  overspendTolerance: string;
  reportingFrequency: string;
  cta: string;
  usp: string;
  notes: string;
};

const defaultForm: WizardFormState = {
  channel: "Meta",
  objective: "Lead generation",
  subscriptionPlan: "enterprise",
  marketingAddon: "marketing_assist",
  projectName: "",
  propertyType: "",
  targetCity: "",
  targetArea: "",
  priceRange: "",
  targetAudience: "",
  primaryGoal: "",
  leadTarget: "100",
  launchDate: "",
  duration: "30 days",
  monthlySpend: 50000,
  overspendTolerance: "Up to 10%",
  reportingFrequency: "Weekly",
  cta: "Book a site visit",
  usp: "",
  notes: "",
};

function formatCurrency(value: number) {
  return `₹${Math.round(value || 0).toLocaleString("en-IN")}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function campaignRowsFromRequest(detail: MarketingRequestDetail | null): Campaign[] {
  if (!detail) return [];
  const baseBudget = detail.monthly_spend || 0;
  if (detail.tasks.length === 0) {
    return [
      {
        id: detail.id,
        name: detail.project_name || detail.request_code,
        channel: detail.channel,
        status: detail.status,
        spend: 0,
        budget: baseBudget,
        leads: detail.lead_target || 0,
        deals_created: 0,
        assigned_to_name: detail.assigned_manager?.name || "",
        deliverable_url: null,
        due_date: detail.launch_date,
      },
    ];
  }
  return detail.tasks.map((task, index) => ({
    id: task.id,
    name: task.title,
    channel: detail.channel,
    status: task.status,
    spend: Math.round(baseBudget / Math.max(1, detail.tasks.length) * (task.status === "completed" ? 1 : 0.55)),
    budget: Math.round(baseBudget / Math.max(1, detail.tasks.length)),
    leads: Math.round((detail.lead_target || 0) / Math.max(1, detail.tasks.length)),
    deals_created: task.status === "completed" ? 1 : 0,
    assigned_to_name: task.assigned_to_name || detail.assigned_manager?.name || "Unassigned",
    deliverable_url: task.deliverable_url,
    due_date: task.due_date,
  }));
}

function funnelFromRequests(rows: MarketingRequestSummary[]): LeadFunnelMetrics {
  return rows.reduce<LeadFunnelMetrics>(
    (acc, row) => {
      if (row.status === "completed") {
        acc.completed += 1;
      } else if (["in_progress", "forwarded_to_employee", "manager_review"].includes(row.status)) {
        acc.in_progress += 1;
      } else if (["agency_review", "agency_approved", "changes_requested"].includes(row.status)) {
        acc.review += 1;
      } else {
        acc.submitted += 1;
      }
      return acc;
    },
    { submitted: 0, in_progress: 0, review: 0, completed: 0 },
  );
}

function MarketingPageInner() {
  const { pushToast } = useToast();
  const location = useLocation();
  const [workspace, setWorkspace] = useState<MarketingWorkspaceAccess | null>(null);
  const [addonStatus, setAddonStatus] = useState<MarketingAddonStatusResponse | null>(null);
  const [metrics, setMetrics] = useState<MarketingMetrics | null>(null);
  const [requests, setRequests] = useState<MarketingRequestSummary[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string>("");
  const [requestDetail, setRequestDetail] = useState<MarketingRequestDetail | null>(null);
  const [activity, setActivity] = useState<MarketingActivityLogEntry[]>([]);
  const [notifications, setNotifications] = useState<MarketingNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState("overview");
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestStep, setRequestStep] = useState(1);
  const [threadComment, setThreadComment] = useState("");
  const [reviewMode, setReviewMode] = useState<"approved" | "changes_requested" | "rejected">("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [form, setForm] = useState<WizardFormState>(defaultForm);
  const [submitting, setSubmitting] = useState(false);

  const selectedRequest = useMemo(
    () => requests.find((row) => row.id === selectedRequestId) || null,
    [requests, selectedRequestId],
  );
  const campaigns = useMemo(() => campaignRowsFromRequest(requestDetail), [requestDetail]);
  const funnel = useMemo(() => funnelFromRequests(requests), [requests]);
  const pendingApprovals = useMemo(
    () => (requestDetail?.approvals || []).filter((row) => row.status === "pending"),
    [requestDetail],
  );
  const unreadNotifications = useMemo(() => notifications.filter((row) => !row.read).length, [notifications]);
  const addonPlans = addonStatus?.plans || [];

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const [workspaceRes, addonRes, requestsRes, notificationsRes] = await Promise.all([
        getMarketingWorkspace(),
        getMarketingAddonStatus(),
        listMarketingRequests().catch(() => []),
        listMarketingNotifications().catch(() => []),
      ]);
      setWorkspace(workspaceRes);
      setAddonStatus(addonRes);
      setRequests(requestsRes);
      setNotifications(notificationsRes);
      setForm((current) => ({
        ...current,
        subscriptionPlan: workspaceRes.subscription_plan || current.subscriptionPlan,
        marketingAddon: addonRes.addon?.addon_type || current.marketingAddon,
      }));

      const requestedId = new URLSearchParams(location.search).get("request");
      const nextRequestId = requestedId || requestsRes[0]?.id || "";
      setSelectedRequestId(nextRequestId);

      if (workspaceRes.request_allowed && addonRes.has_active_addon) {
        setMetricsLoading(true);
        try {
          const metricsRes = await getMarketingMetrics();
          setMetrics(metricsRes);
        } finally {
          setMetricsLoading(false);
        }
      } else {
        setMetrics(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the marketing workspace");
    } finally {
      setLoading(false);
    }
  }

  async function loadRequestDetail(requestId: string) {
    if (!requestId) {
      setRequestDetail(null);
      setActivity([]);
      return;
    }
    setRequestLoading(true);
    try {
      const [detailRes, activityRes] = await Promise.all([
        getMarketingRequest(requestId),
        listMarketingActivity(requestId).catch(() => []),
      ]);
      setRequestDetail(detailRes);
      setActivity(activityRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load request detail");
    } finally {
      setRequestLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [location.search]);

  useEffect(() => {
    if (!selectedRequestId) return;
    void loadRequestDetail(selectedRequestId);
  }, [selectedRequestId]);

  async function handleSendComment() {
    if (!requestDetail || !threadComment.trim()) return;
    try {
      const created = await addMarketingComment(requestDetail.id, threadComment.trim());
      setRequestDetail((current) =>
        current ? { ...current, comments: [...current.comments, created] } : current,
      );
      setThreadComment("");
      pushToast("Comment added to the marketing thread.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the comment");
    }
  }

  function handleCommentKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendComment();
    }
  }

  function openApproval(approval: Approval, mode: "approved" | "changes_requested" | "rejected" = "approved") {
    setSelectedApproval(approval);
    setReviewMode(mode);
    setReviewNote("");
    setShowReviewModal(true);
  }

  async function handleApprovalAction() {
    if (!selectedApproval) return;
    try {
      const updated = await ownerSignOffMarketingApproval(selectedApproval.id, reviewMode, reviewNote.trim());
      setRequestDetail((current) =>
        current
          ? {
              ...current,
              approvals: current.approvals.map((row) => (row.id === updated.id ? updated : row)),
              status: reviewMode === "approved" ? "completed" : "changes_requested",
            }
          : current,
      );
      setShowReviewModal(false);
      pushToast(`Approval marked as ${reviewMode.replace(/_/g, " ")}.`, reviewMode === "approved" ? "success" : "warning");
      if (requestDetail) {
        await loadRequestDetail(requestDetail.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update approval");
    }
  }

  async function handleSubmitRequest() {
    if (!workspace?.request_allowed) {
      setError(workspace?.upgrade_message || "Upgrade is required before you can submit marketing requests.");
      return;
    }
    if (!addonStatus?.has_active_addon) {
      setError("Activate a marketing add-on before sending work to the marketing portal.");
      return;
    }
    if (form.marketingAddon === "managed_marketing" && !workspace.managed_marketing_allowed) {
      setError("Managed Marketing is only available on eligible plans.");
      return;
    }
    const payload: MarketingRequestCreatePayload = {
      channel: form.channel,
      objective: form.objective,
      project_name: form.projectName.trim(),
      property_type: form.propertyType.trim(),
      target_city: form.targetCity.trim(),
      target_area: form.targetArea.trim(),
      price_range: form.priceRange.trim(),
      target_audience: form.targetAudience.trim(),
      primary_goal: form.primaryGoal.trim(),
      lead_target: Number(form.leadTarget) || 0,
      launch_date: form.launchDate || null,
      duration: form.duration.trim(),
      monthly_spend: Number(form.monthlySpend) || 0,
      overspend_tolerance: form.overspendTolerance.trim(),
      reporting_frequency: form.reportingFrequency.trim(),
      cta: form.cta.trim(),
      usp: form.usp.trim(),
      notes: form.notes.trim(),
    };
    setSubmitting(true);
    setError(null);
    try {
      const created = await createMarketingRequest(payload);
      setShowRequestModal(false);
      setRequestStep(1);
      setForm((current) => ({ ...defaultForm, subscriptionPlan: current.subscriptionPlan, marketingAddon: current.marketingAddon }));
      pushToast(`Request ${created.request_code} submitted successfully.`, "success");
      await loadDashboard();
      setSelectedRequestId(created.id);
      await loadRequestDetail(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the marketing request");
    } finally {
      setSubmitting(false);
    }
  }

  async function markNotificationDone(notification: MarketingNotification) {
    if (notification.read) return;
    try {
      await markMarketingNotificationRead(notification.id);
      setNotifications((current) => current.map((row) => (row.id === notification.id ? { ...row, read: true } : row)));
    } catch {
      // Keep quiet in UI; this should not block the workspace.
    }
  }

  function renderUpgradeState() {
    return (
      <section className="marketingPromptPanel marketingPromptUpgrade">
        <div className="marketingPromptPanelHeader">
          <div>
            <div className="marketingPromptLabel">Upgrade required</div>
            <div className="marketingPromptPanelTitle">Marketing portal is not unlocked on this workspace yet</div>
          </div>
        </div>
        <p className="muted">{workspace?.upgrade_message || "Upgrade your CRM plan to unlock marketing requests and account allotment."}</p>
        {addonPlans.length ? (
          <div className="marketingPromptPlanGrid">
            {addonPlans.map((plan: MarketingAddonCatalogPlan) => (
              <div key={plan.addon_type} className="marketingPromptPlanCard">
                <strong>{plan.addon_type.replace(/_/g, " ")}</strong>
                <div>{formatCurrency(plan.monthly_amount)} / month</div>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  function renderOverview() {
    return (
      <>
        <MetricsRow loading={metricsLoading} error={null} metrics={metrics} onRetry={() => void loadDashboard()} />

        {selectedRequest ? (
          <section className="marketingPromptPanel">
            <div className="marketingPromptPanelHeader">
              <div>
                <div className="marketingPromptLabel">Request list</div>
                <div className="marketingPromptPanelTitle">Submitted marketing work</div>
              </div>
            </div>
            <div className="marketingPromptRequestList">
              {requests.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`marketingPromptRequestCard ${row.id === selectedRequestId ? "active" : ""}`}
                  onClick={() => setSelectedRequestId(row.id)}
                >
                  <div>
                    <strong>{row.request_code}</strong>
                    <span>{row.project_name || row.objective || row.channel}</span>
                  </div>
                  <div className="marketingPromptRequestMeta">
                    <span className={`marketingPromptStatusChip ${row.status}`}>{row.status.replace(/_/g, " ")}</span>
                    <small>{formatDateTime(row.updated_at)}</small>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="marketingPromptPanel">
          <div className="marketingPromptPanelHeader">
            <div>
              <div className="marketingPromptLabel">Execution board</div>
              <div className="marketingPromptPanelTitle">{requestDetail?.request_code || "Campaign execution"}</div>
            </div>
          </div>
          <CampaignsTable
            loading={requestLoading}
            error={null}
            campaigns={campaigns}
            onRetry={() => void loadRequestDetail(selectedRequestId)}
            onOpen={() => undefined}
            onCreateRequest={() => setShowRequestModal(true)}
          />
        </section>

        <div className="marketingPromptOverviewGrid">
          <LeadFunnel campaignName={requestDetail?.project_name || "Request flow"} metrics={funnel} />
          <div className="marketingPromptRightStack">
            <section className="marketingPromptPanel">
              <div className="marketingPromptPanelHeader">
                <div>
                  <div className="marketingPromptLabel">Pending approvals</div>
                  <div className="marketingPromptPanelTitle">Owner sign-off queue</div>
                </div>
              </div>
              <PendingApprovals
                loading={requestLoading}
                error={null}
                approvals={pendingApprovals}
                onRetry={() => void loadRequestDetail(selectedRequestId)}
                onReview={(approval) => openApproval(approval, "changes_requested")}
                onApprove={(approval) => openApproval(approval, "approved")}
              />
            </section>

            <PhaseTracker status={requestDetail?.status || "submitted"} canEdit={false} onPick={() => undefined} />
          </div>
        </div>
      </>
    );
  }

  function renderMessages() {
    return (
      <div className="marketingPromptOverviewGrid">
        <MessageCenter
          role="owner"
          requestDetail={requestDetail}
          threadComment={threadComment}
          setThreadComment={setThreadComment}
          handleCommentKeyDown={handleCommentKeyDown}
          sendThreadComment={() => void handleSendComment()}
          open
          onToggle={() => undefined}
        />
        <section className="marketingPromptPanel">
          <div className="marketingPromptPanelHeader">
            <div>
              <div className="marketingPromptLabel">Activity log</div>
              <div className="marketingPromptPanelTitle">Notifications and handoffs</div>
            </div>
          </div>
          <div className="marketingPromptActivityList">
            {notifications.length === 0 && activity.length === 0 ? <div className="muted">No activity yet.</div> : null}
            {notifications.map((row) => (
              <button key={row.id} type="button" className={`marketingPromptActivityItem ${row.read ? "" : "unread"}`} onClick={() => void markNotificationDone(row)}>
                <strong>{row.message}</strong>
                <span>{formatDateTime(row.created_at)}</span>
              </button>
            ))}
            {activity.map((row) => (
              <div key={row.id} className="marketingPromptActivityItem">
                <strong>{row.message}</strong>
                <span>{row.detail || row.actor_role}</span>
                <small>{formatDateTime(row.created_at)}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderReports() {
    return (
      <div className="marketingPromptOverviewGrid">
        <ReportsPanel metrics={metrics} />
        <section className="marketingPromptPanel">
          <div className="marketingPromptPanelHeader">
            <div>
              <div className="marketingPromptLabel">Current request</div>
              <div className="marketingPromptPanelTitle">{requestDetail?.project_name || "No request selected"}</div>
            </div>
          </div>
          {requestDetail ? (
            <div className="marketingPromptKeyValueGrid">
              <div><span>Channel</span><b>{requestDetail.channel}</b></div>
              <div><span>Objective</span><b>{requestDetail.objective || "-"}</b></div>
              <div><span>Target city</span><b>{requestDetail.target_city || "-"}</b></div>
              <div><span>Budget</span><b>{formatCurrency(requestDetail.monthly_spend)}</b></div>
              <div><span>Lead target</span><b>{requestDetail.lead_target || 0}</b></div>
              <div><span>Reporting</span><b>{requestDetail.reporting_frequency || "-"}</b></div>
            </div>
          ) : (
            <div className="muted">Select a request to review reporting details.</div>
          )}
        </section>
      </div>
    );
  }

  function renderBilling() {
    return (
      <div className="marketingPromptOverviewGrid">
        <BillingPanel metrics={metrics} />
        <section className="marketingPromptPanel">
          <div className="marketingPromptPanelHeader">
            <div>
              <div className="marketingPromptLabel">Addon catalog</div>
              <div className="marketingPromptPanelTitle">Available marketing layers</div>
            </div>
          </div>
          <div className="marketingPromptPlanGrid">
            {addonPlans.length === 0 ? (
              <div className="muted">No addon plans available right now.</div>
            ) : (
              addonPlans.map((plan) => (
                <div key={plan.addon_type} className="marketingPromptPlanCard">
                  <strong>{plan.addon_type.replace(/_/g, " ")}</strong>
                  <div>{formatCurrency(plan.monthly_amount)} / month</div>
                  <small>{plan.term_days} day term</small>
                  <ul>
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    );
  }

  const title = workspace?.role === "admin" ? "Marketing admin workspace" : "Marketing requests";
  const subtitle =
    workspace?.role === "admin"
      ? "Admin visibility into request flow, account allotment, and subscriber marketing readiness."
      : "Submit marketing work, review approvals, and follow delivery updates from one place.";

  return (
    <div className="marketingStandaloneApp">
      <MarketingSidebar
        active={activeNav}
        pendingApprovals={pendingApprovals.length}
        unreadComments={unreadNotifications}
        role={workspace?.role || "subscriber"}
        onChange={setActiveNav}
        onNewRequest={() => setShowRequestModal(true)}
        showNewRequest={workspace?.role !== "admin"}
      />

      <div className="marketingStandaloneContent">
        <MarketingTopBar
          eyebrow={workspace?.role === "admin" ? "Admin marketing portal" : "Subscriber marketing portal"}
          title={title}
          subtitle={subtitle}
          onRefresh={() => void loadDashboard()}
          onNewRequest={workspace?.role === "admin" ? undefined : () => setShowRequestModal(true)}
        />

        <main className="marketingPromptMain">
          {error ? <div className="alert">{error}</div> : null}
          {loading ? (
            <div className="skeletonCard">
              <div className="skeletonBar" style={{ width: "42%" }} />
              <div className="skeletonBar" style={{ width: "88%" }} />
              <div className="skeletonBar" style={{ width: "66%" }} />
            </div>
          ) : workspace?.upgrade_required ? (
            renderUpgradeState()
          ) : !addonStatus?.has_active_addon ? (
            <section className="marketingPromptPanel marketingPromptUpgrade">
              <div className="marketingPromptPanelHeader">
                <div>
                  <div className="marketingPromptLabel">Addon required</div>
                  <div className="marketingPromptPanelTitle">Activate a marketing add-on before sending work</div>
                </div>
              </div>
              <p className="muted">The request wizard is ready, but the live marketing portal opens only after an active Marketing Assist or Managed Marketing addon is attached to this account.</p>
              {renderBilling()}
            </section>
          ) : activeNav === "messages" ? (
            renderMessages()
          ) : activeNav === "reports" ? (
            renderReports()
          ) : activeNav === "billing" ? (
            renderBilling()
          ) : (
            renderOverview()
          )}
        </main>
      </div>

      <Modal title="New marketing request" open={showRequestModal} onClose={() => setShowRequestModal(false)}>
        <div className="marketingPromptWizard">
          <div className="marketingPromptWizardHeader">
            <div>
              <div className="marketingPromptLabel">New marketing request</div>
              <div className="marketingPromptPanelTitle">Campaign setup</div>
            </div>
            <div className="marketingPromptWizardMeta">Step {requestStep} of 5</div>
          </div>

          <div className="marketingPromptStepBar">
            {[1, 2, 3, 4, 5].map((step) => (
              <div key={step} className={`marketingPromptStep ${requestStep === step ? "active" : requestStep > step ? "done" : ""}`}>
                Step {step}
              </div>
            ))}
          </div>

          {requestStep === 1 ? (
            <div className="marketingPromptFormGrid">
              <label>
                Channel
                <select value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))}>
                  <option>Meta</option>
                  <option>Google</option>
                  <option>Instagram</option>
                  <option>YouTube</option>
                  <option>WhatsApp</option>
                </select>
              </label>
              <label>
                Objective
                <select value={form.objective} onChange={(event) => setForm((current) => ({ ...current, objective: event.target.value }))}>
                  <option>Lead generation</option>
                  <option>Awareness</option>
                  <option>Project launch</option>
                  <option>Retargeting</option>
                  <option>Site visits</option>
                </select>
              </label>
              <label>
                Subscription plan
                <input value={form.subscriptionPlan} readOnly />
              </label>
              <label>
                Marketing add-on
                <select value={form.marketingAddon} onChange={(event) => setForm((current) => ({ ...current, marketingAddon: event.target.value }))}>
                  <option value="marketing_assist">Marketing Assist</option>
                  <option value="managed_marketing">Managed Marketing</option>
                </select>
              </label>
            </div>
          ) : null}

          {requestStep === 2 ? (
            <div className="marketingPromptFormGrid">
              <label>
                Project / property name
                <input value={form.projectName} onChange={(event) => setForm((current) => ({ ...current, projectName: event.target.value }))} />
              </label>
              <label>
                Property type
                <input value={form.propertyType} onChange={(event) => setForm((current) => ({ ...current, propertyType: event.target.value }))} />
              </label>
              <label>
                Target city
                <input value={form.targetCity} onChange={(event) => setForm((current) => ({ ...current, targetCity: event.target.value }))} />
              </label>
              <label>
                Target micro-area
                <input value={form.targetArea} onChange={(event) => setForm((current) => ({ ...current, targetArea: event.target.value }))} />
              </label>
              <label>
                Price range
                <input value={form.priceRange} onChange={(event) => setForm((current) => ({ ...current, priceRange: event.target.value }))} />
              </label>
              <label>
                Target audience
                <input value={form.targetAudience} onChange={(event) => setForm((current) => ({ ...current, targetAudience: event.target.value }))} />
              </label>
            </div>
          ) : null}

          {requestStep === 3 ? (
            <div className="marketingPromptFormStack">
              <label>
                Monthly spend
                <input
                  type="range"
                  min={10000}
                  max={250000}
                  step={5000}
                  value={form.monthlySpend}
                  onChange={(event) => setForm((current) => ({ ...current, monthlySpend: Number(event.target.value) }))}
                />
              </label>
              <div className="marketingPromptBudgetSummary">
                <div><span>Monthly spend</span><b>{formatCurrency(form.monthlySpend)}</b></div>
                <div><span>Lead target</span><b>{Number(form.leadTarget) || 0}</b></div>
                <div><span>Reporting</span><b>{form.reportingFrequency}</b></div>
                <div><span>Launch date</span><b>{form.launchDate || "Flexible"}</b></div>
              </div>
            </div>
          ) : null}

          {requestStep === 4 ? (
            <div className="marketingPromptAssetGrid">
              {["Property images", "Videos / walkthrough", "Brochure / floor plan", "Logo / brand kit"].map((label) => (
                <div key={label} className="marketingPromptAssetCard">
                  <div className="marketingPromptAssetIcon">+</div>
                  <b>{label}</b>
                  <span>Asset upload will connect here in the next pass.</span>
                </div>
              ))}
            </div>
          ) : null}

          {requestStep === 5 ? (
            <div className="marketingPromptFormStack">
              <label>
                CTA
                <input value={form.cta} onChange={(event) => setForm((current) => ({ ...current, cta: event.target.value }))} />
              </label>
              <label>
                Key message / USP
                <textarea className="textarea" value={form.usp} onChange={(event) => setForm((current) => ({ ...current, usp: event.target.value }))} />
              </label>
              <label>
                Additional notes
                <textarea className="textarea" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>
            </div>
          ) : null}

          <div className="marketingPromptWizardActions">
            <button className="btn ghost" type="button" disabled={requestStep === 1 || submitting} onClick={() => setRequestStep((current) => Math.max(1, current - 1))}>
              Back
            </button>
            {requestStep < 5 ? (
              <button className="btn" type="button" onClick={() => setRequestStep((current) => Math.min(5, current + 1))}>
                Continue
              </button>
            ) : (
              <button className="btn" type="button" disabled={submitting} onClick={() => void handleSubmitRequest()}>
                {submitting ? "Submitting..." : "Submit request"}
              </button>
            )}
          </div>
        </div>
      </Modal>

      <Modal title="Review approval" open={showReviewModal} onClose={() => setShowReviewModal(false)}>
        {selectedApproval ? (
          <div className="marketingPromptFormStack">
            <div className="marketingPromptPanel soft">
              <div className="marketingPromptLabel">Approval type</div>
              <div className="marketingPromptPanelTitle">{selectedApproval.approval_type.replace(/_/g, " ")}</div>
              <p className="muted">{selectedApproval.description}</p>
            </div>
            <label>
              Decision
              <select value={reviewMode} onChange={(event) => setReviewMode(event.target.value as "approved" | "changes_requested" | "rejected")}>
                <option value="approved">Approve</option>
                <option value="changes_requested">Request changes</option>
                <option value="rejected">Reject</option>
              </select>
            </label>
            <label>
              Note
              <textarea className="textarea" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Explain your decision for the marketing team." />
            </label>
            <div className="marketingPromptWizardActions">
              <button className="btn ghost" type="button" onClick={() => setShowReviewModal(false)}>
                Cancel
              </button>
              <button className="btn" type="button" onClick={() => void handleApprovalAction()}>
                Submit decision
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default function MarketingPage() {
  return (
    <ToastProvider>
      <MarketingPageInner />
    </ToastProvider>
  );
}
