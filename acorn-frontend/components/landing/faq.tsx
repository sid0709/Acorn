import { FAQS, LANDING_SECTIONS } from "@/lib/landing";
import { SectionTitle } from "./section-title";

/** Answers stay in the DOM while collapsed, so crawlers read them with the FAQPage data. */
export function Faq() {
  return (
    <section id={LANDING_SECTIONS.faq} aria-labelledby="faq-title">
      <SectionTitle
        id="faq-title"
        title="What people ask before they let an agent apply for them"
        description="Straight answers on how Acorn applies, which AI it uses, and what it costs."
      />
      <div className="ac-faq">
        {FAQS.map((faq, index) => (
          <details key={faq.question} className="ac-faq-item" open={index === 0}>
            <summary>{faq.question}</summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
