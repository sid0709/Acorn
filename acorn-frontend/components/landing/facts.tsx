import { AGENT_FLOW, JOB_SITES } from "@/lib/landing";

/** The page's own numbers, taken from its copy: nothing here is a claim about results. */
const FACTS = [
  { value: String(JOB_SITES.length - 1), unit: "+", label: "Application systems named" },
  { value: String(AGENT_FLOW.length), unit: "", label: "Steps from posting to reply" },
  { value: "1", unit: " click", label: "To send an application" },
  { value: "Free", unit: "", label: "Plan, no credit card" },
] as const;

export function Facts() {
  return (
    <section className="ac-metrics" aria-label="At a glance">
      <div className="ac-metrics-grid">
        {FACTS.map((fact) => (
          <div key={fact.label} data-hover>
            <div className="ac-metric-val">
              <span>{fact.value}</span>
              {fact.unit}
            </div>
            <div className="ac-metric-label">{fact.label}</div>
          </div>
        ))}
      </div>
      <ul className="ac-sites" aria-label="Works on">
        {JOB_SITES.map((site) => (
          <li key={site} className="ac-tech-pill">
            {site}
          </li>
        ))}
      </ul>
    </section>
  );
}
