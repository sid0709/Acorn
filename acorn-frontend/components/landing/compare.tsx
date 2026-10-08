import { LANDING_SECTIONS } from "@/lib/landing";
import { ComparisonTable } from "./comparison-table";
import { LandingSection } from "./landing-section";

export function Compare() {
  return (
    <LandingSection
      id={LANDING_SECTIONS.compare}
      eyebrow="Manual vs. auto-bid"
      title="Stop filling forms. Start getting interviews."
      description="The average job seeker spends hours a week retyping the same answers. Here is what changes when an AI agent does the applying."
    >
      <ComparisonTable />
    </LandingSection>
  );
}
