import Link from "next/link";
import { PLANS, formatPrice, type PlanId } from "@/lib/billing";
import { CTA_START, LANDING_SECTIONS } from "@/lib/landing";
import { ROUTES } from "@/lib/routes";
import { SectionTitle } from "./section-title";

/** The plan the page points an active job seeker to. */
const HIGHLIGHTED_PLAN: PlanId = "pro";

export function Pricing() {
  return (
    <section id={LANDING_SECTIONS.pricing} aria-labelledby="pricing-title">
      <SectionTitle
        id="pricing-title"
        title="Start free. Upgrade when your search heats up."
        description="Every plan includes the agent, autofill, and your profile. No credit card to start."
      />
      <div className="ac-card-grid">
        {PLANS.map((plan) => {
          const highlighted = plan.id === HIGHLIGHTED_PLAN;
          const free = plan.price.monthly === 0;
          return (
            <article
              key={plan.id}
              className={highlighted ? "ac-card ac-plan ac-plan-hot" : "ac-card ac-plan"}
              data-hover
            >
              <div className="ac-card-tag">{highlighted ? "Recommended" : plan.name}</div>
              <h3>{plan.name}</h3>
              <p>{plan.tagline}</p>
              <div className="ac-price">
                {formatPrice(plan.price.monthly)}
                <span> / month</span>
              </div>
              <div className="ac-price-note">
                {free ? "Free forever" : `${formatPrice(plan.price.yearly)} / month billed yearly`}
              </div>
              <ul className="ac-plan-list">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link
                href={ROUTES.signUp}
                className={highlighted ? "ac-btn ac-btn-primary" : "ac-btn ac-btn-glass"}
              >
                {free ? CTA_START : `Start with ${plan.name}`}
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
