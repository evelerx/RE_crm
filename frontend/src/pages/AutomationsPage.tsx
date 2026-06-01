import { useEffect, useMemo, useState } from "react";

import {
  createAutomationRule,
  deleteAutomationRule,
  listAutomationLogs,
  listAutomationRules,
  updateAutomationRule,
} from "../api/client";
import type { AutomationAction, AutomationLog, AutomationRule } from "../api/types";

const triggerOptions = [
  { value: "contact_created", label: "Contact created" },
  { value: "deal_created", label: "Deal created" },
  { value: "deal_stage_changed", label: "Deal stage changed" },
  { value: "activity_overdue", label: "Activity overdue" },
  { value: "deal_score_low", label: "Deal score low" },
] as const;

const actionOptions = [
  { value: "send_whatsapp", label: "Send WhatsApp" },
  { value: "create_activity", label: "Create activity" },
  { value: "assign_deal", label: "Assign deal" },
  { value: "send_email", label: "Send email" },
  { value: "update_deal_field", label: "Update deal field" },
  { value: "webhook_notify", label: "Webhook notify" },
] as const;

const emptyAction: AutomationAction = {
  type: "create_activity",
  config: { summary: "Follow up {{contact_name}}" },
};

function parseFilters(text: string) {
  if (!text.trim()) return {};
  return JSON.parse(text) as Record<string, string | number | boolean | null>;
}

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [logs, setLogs] = useState<Record<string, AutomationLog[]>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState<string>("");
  const [form, setForm] = useState({
    name: "",
    trigger_event: "deal_created",
    trigger_filters_text: '{\n  "source": "facebook_ads"\n}',
    is_active: true,
    actions: [emptyAction] as AutomationAction[],
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const rows = await listAutomationRules();
      setRules(rows);
      if (rows.length && !selectedRuleId) setSelectedRuleId(rows[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs(ruleId: string) {
    try {
      const rows = await listAutomationLogs(ruleId);
      setLogs((current) => ({ ...current, [ruleId]: rows }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automation logs");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (selectedRuleId) void loadLogs(selectedRuleId);
  }, [selectedRuleId]);

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) || null,
    [rules, selectedRuleId],
  );

  function updateAction(index: number, next: AutomationAction) {
    setForm((current) => ({
      ...current,
      actions: current.actions.map((action, actionIndex) => (actionIndex === index ? next : action)),
    }));
  }

  async function handleCreate() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const created = await createAutomationRule({
        name: form.name.trim(),
        trigger_event: form.trigger_event as AutomationRule["trigger_event"],
        trigger_filters: parseFilters(form.trigger_filters_text),
        actions: form.actions,
        is_active: form.is_active,
      });
      setSuccess("Automation rule created.");
      setForm({
        name: "",
        trigger_event: "deal_created",
        trigger_filters_text: '{\n  "source": "facebook_ads"\n}',
        is_active: true,
        actions: [emptyAction],
      });
      setRules((current) => [created, ...current]);
      setSelectedRuleId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save automation");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rule: AutomationRule) {
    try {
      const updated = await updateAutomationRule(rule.id, { is_active: !rule.is_active });
      setRules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update automation");
    }
  }

  async function handleDelete(ruleId: string) {
    try {
      await deleteAutomationRule(ruleId);
      setRules((current) => current.filter((item) => item.id !== ruleId));
      if (selectedRuleId === ruleId) setSelectedRuleId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete automation");
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="eyebrowText">Automation</div>
          <div className="h1">Visual workflow automations</div>
          <div className="muted">Create trigger-based CRM actions for follow-up, assignment, WhatsApp, email, and webhooks.</div>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {success ? <div className="alert ok">{success}</div> : null}

      <div className="automationsGrid">
        <div className="card automationsBuilder">
          <div className="cardTitle">New automation rule</div>
          <div className="form">
            <div className="grid2">
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Example: New Facebook leads get follow-up"
              />
              <select
                value={form.trigger_event}
                onChange={(event) => setForm((current) => ({ ...current, trigger_event: event.target.value }))}
              >
                {triggerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="small muted">Trigger filters (JSON)</label>
            <textarea
              className="textarea monoPreview"
              value={form.trigger_filters_text}
              onChange={(event) => setForm((current) => ({ ...current, trigger_filters_text: event.target.value }))}
            />
            <label className="small muted">Actions</label>
            <div className="automationActionsList">
              {form.actions.map((action, index) => (
                <div key={`${action.type}-${index}`} className="automationActionCard">
                  <div className="grid2">
                    <select
                      value={action.type}
                      onChange={(event) => updateAction(index, { ...action, type: event.target.value as AutomationAction["type"] })}
                    >
                      {actionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          actions: current.actions.filter((_, actionIndex) => actionIndex !== index),
                        }))
                      }
                      disabled={form.actions.length === 1}
                      title={form.actions.length === 1 ? "At least one action is required" : "Remove this action"}
                    >
                      Remove action
                    </button>
                  </div>
                  <textarea
                    className="textarea monoPreview"
                    value={JSON.stringify(action.config, null, 2)}
                    onChange={(event) => {
                      try {
                        const parsed = JSON.parse(event.target.value);
                        updateAction(index, { ...action, config: parsed });
                        setError("");
                      } catch {
                        setError("Action config must be valid JSON.");
                      }
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="row">
              <button
                className="btn ghost"
                type="button"
                onClick={() => setForm((current) => ({ ...current, actions: [...current.actions, emptyAction] }))}
              >
                Add action
              </button>
              <label className="checkboxLabel">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                />
                Active immediately
              </label>
            </div>
            <button className="btn" type="button" onClick={() => void handleCreate()} disabled={saving}>
              {saving ? "Saving..." : "Create automation"}
            </button>
          </div>
        </div>

        <div className="card automationsLibrary">
          <div className="cardTitle">Existing automations</div>
          <div className="list">
            {rules.length ? (
              rules.map((rule) => (
                <div key={rule.id} className={`listItem ${selectedRuleId === rule.id ? "automationSelected" : ""}`}>
                  <div className="row automationRuleHead">
                    <div className="grow">
                      <strong>{rule.name}</strong>
                      <div className="small muted">{rule.trigger_event.replaceAll("_", " ")}</div>
                    </div>
                    <span className={`pill ${rule.is_active ? "enterprisePill" : ""}`}>{rule.is_active ? "Active" : "Paused"}</span>
                  </div>
                  <div className="small muted">Runs: {rule.run_count} · Last run: {rule.last_run_at ? new Date(rule.last_run_at).toLocaleString() : "Never"}</div>
                  <div className="row automationRuleActions">
                    <button className="btn ghost compact" type="button" onClick={() => setSelectedRuleId(rule.id)}>
                      View logs
                    </button>
                    <button className="btn ghost compact" type="button" onClick={() => void handleToggle(rule)}>
                      {rule.is_active ? "Pause" : "Enable"}
                    </button>
                    <button className="btn ghost compact" type="button" onClick={() => void handleDelete(rule.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="listItem small muted">No automation rules yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardTitle">Automation logs</div>
        {selectedRule ? (
          <div className="list">
            {(logs[selectedRule.id] || []).length ? (
              (logs[selectedRule.id] || []).map((log) => (
                <div key={log.id} className="listItem">
                  <div className="row automationRuleHead">
                    <strong>{log.trigger_event.replaceAll("_", " ")}</strong>
                    <span className={`pill ${log.status === "success" ? "enterprisePill" : ""}`}>{log.status}</span>
                  </div>
                  <div className="small muted">
                    {new Date(log.created_at).toLocaleString()} · {log.actions_executed.join(", ") || "No actions"}
                  </div>
                  {log.error_message ? <div className="small dangerText">{log.error_message}</div> : null}
                </div>
              ))
            ) : (
              <div className="listItem small muted">No logs yet for {selectedRule.name}.</div>
            )}
          </div>
        ) : (
          <div className="listItem small muted">Select a rule to inspect its recent execution logs.</div>
        )}
      </div>
    </div>
  );
}
