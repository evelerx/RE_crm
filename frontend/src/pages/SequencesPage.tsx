// MODIFIED: Part 5G — Sequences page scaffold — Adds a visual sequence builder shell so the CRM can expose this workspace without dead navigation.
import { useState } from "react";

type SequenceStep = {
  id: string;
  delay: string;
  subject: string;
  body: string;
};

export default function SequencesPage() {
  const [steps, setSteps] = useState<SequenceStep[]>([
    {
      id: "step-1",
      delay: "0h",
      subject: "Quick follow-up",
      body: "Hi {{name}}, sharing the next best option based on your last site visit.",
    },
    {
      id: "step-2",
      delay: "24h",
      subject: "Checking in",
      body: "Just checking if you would like a short call to compare units and pricing.",
    },
  ]);

  function patchStep(id: string, key: keyof SequenceStep, value: string) {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, [key]: value } : step)));
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Sequences</div>
          <div className="muted">Stage-based and manual follow-up sequences for organized outreach.</div>
        </div>
      </div>

      <div className="sequenceBuilderLayout">
        <section className="card card-pad">
          <div className="cardTitle">Sequence builder</div>
          <div className="sequenceSteps">
            {steps.map((step, index) => (
              <div key={step.id} className="sequenceStepCard">
                <div className="sequenceStepBadge">Step {index + 1}</div>
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
            <button
              className="btn ghost"
              type="button"
              onClick={() =>
                setSteps((current) => [
                  ...current,
                  { id: `step-${current.length + 1}`, delay: "48h", subject: "New follow-up", body: "Draft the next touchpoint here." },
                ])
              }
            >
              Add step +
            </button>
            <button className="btn" type="button">
              Save sequence
            </button>
          </div>
        </section>

        <section className="card card-pad">
          <div className="cardTitle">Preview</div>
          <div className="sequencePreviewMock">
            <strong>{steps[0]?.subject || "Preview subject"}</strong>
            <p>{steps[0]?.body || "Preview body"}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
