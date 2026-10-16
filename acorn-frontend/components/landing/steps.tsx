import { AGENT_FLOW, LANDING_SECTIONS } from "@/lib/landing";
import { SectionTitle } from "./section-title";

export function Steps() {
  return (
    <section id={LANDING_SECTIONS.agent} aria-labelledby="steps-title">
      <SectionTitle
        id="steps-title"
        title="Open a job. Acorn does the rest."
        description="Six steps that replace twenty minutes of typing on every application."
      />
      <ol className="ac-steps-grid">
        {AGENT_FLOW.map((step, index) => (
          <li key={step.id} className="ac-step" data-hover>
            <div className="ac-step-number">{String(index + 1).padStart(2, "0")}</div>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
