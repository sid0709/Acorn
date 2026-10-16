import { FEATURES, LANDING_SECTIONS } from "@/lib/landing";
import { SectionTitle } from "./section-title";

export function Features() {
  return (
    <section id={LANDING_SECTIONS.features} aria-labelledby="features-title">
      <SectionTitle
        id="features-title"
        title="Everything an application asks for, answered"
        description="Acorn does not spam generic answers. It reads the posting and the form, then fills each field from your own profile."
      />
      <div className="ac-card-grid">
        {FEATURES.map((feature, index) => (
          <article key={feature.title} className="ac-card" data-hover>
            <div className="ac-card-tag">{String(index + 1).padStart(2, "0")}</div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
