// MODIFIED: Sequences persistence wiring — Replaces the no-op sequence scaffold with real load/save behavior backed by the CRM API.
import { useEffect, useMemo, useState } from "react";

import { getDefaultSequence, saveDefaultSequence } from "../api/client";
import type { FollowUpSequence, SequenceStep } from "../api/types";

function makeStep(index: number): SequenceStep {
  return {
    id: `step-${Date.now()}-${index}`,
    delay: index === 0 ? "0h" : "24h",
    subject: index === 0 ? "Quick follow-up" : "Checking in",
    body:
      index === 0
        ? "Hi {{name}}, sharing the next best option based on your last site visit."
        : "Just checking if you would like a short call to compare units and pricing.",
  };
}

export default function SequencesPage() {
  const [sequence, setSequence] = useState<FollowUpSequence | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getDefaultSequence();
      setSequence(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load sequence.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function patchStep(id: string, key: keyof SequenceStep, value: string) {
    setSequence((current) =>
      current
        ? {
            ...current,
            steps: current.steps.map((step) => (step.id === id ? { ...step, [key]: value } : step)),
          }
        : current,
    );
  }

  function addStep() {
    setSequence((current) =>
      current
        ? {
            ...current,
            steps: [...current.steps, makeStep(current.steps.length)],
          }
        : current,
    );
  }

  function removeStep(id: string) {
    setSequence((current) =>
      current && current.steps.length > 1
        ? {
            ...current,
            steps: current.steps.filter((step) => step.id !== id),
          }
        : current,
    );
  }

  async function saveSequence() {
    if (!sequence) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveDefaultSequence({
        name: sequence.name,
        steps: sequence.steps,
      });
      setSequence(saved);
      setMessage("Sequence saved.");
      window.setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save sequence.");
    } finally {
      setSaving(false);
    }
  }

  const preview = useMemo(() => sequence?.steps[0] ?? null, [sequence]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Sequences</div>
          <div className="muted">Stage-based and manual follow-up sequences for organized outreach.</div>
        </div>
        <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <div className="alert err">{error}</div> : null}
      {message ? <div className="alert ok">{message}</div> : null}

      <div className="sequenceBuilderLayout">
        <section className="card card-pad">
          <div className="cardTitle">Sequence builder</div>
          {loading || !sequence ? (
            <div className="muted">Loading sequence...</div>
          ) : (
            <>
              <label>
                Sequence name
                <input
                  value={sequence.name}
                  onChange={(event) => setSequence((current) => (current ? { ...current, name: event.target.value } : current))}
                  placeholder="Default sequence"
                />
              </label>

              <div className="sequenceSteps">
                {sequence.steps.map((step, index) => (
                  <div key={step.id} className="sequenceStepCard">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <div className="sequenceStepBadge">Step {index + 1}</div>
                      <button className="btn ghost compact" type="button" onClick={() => removeStep(step.id)} disabled={sequence.steps.length <= 1}>
                        Remove
                      </button>
                    </div>
                    <div className="grid2">
                      <label>
                        Delay
                        <input value={step.delay} onChange={(event) => patchStep(step.id, "delay", event.target.value)} />
                      </label>
                      <label>
                        Subject
                        <input value={step.subject} onChange={(event) => patchStep(step.id, "subject", event.target.value)} />
                      </label>
                    </div>
                    <label>
                      Body
                      <textarea className="textarea" value={step.body} onChange={(event) => patchStep(step.id, "body", event.target.value)} />
                    </label>
                  </div>
                ))}
              </div>
              <div className="row">
                <button className="btn ghost" type="button" onClick={addStep}>
                  Add step +
                </button>
                <button className="btn" type="button" onClick={() => void saveSequence()} disabled={saving}>
                  {saving ? "Saving..." : "Save sequence"}
                </button>
              </div>
            </>
          )}
        </section>

        <section className="card card-pad">
          <div className="cardTitle">Preview</div>
          <div className="sequencePreviewMock">
            <strong>{preview?.subject || "Preview subject"}</strong>
            <p>{preview?.body || "Preview body"}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
