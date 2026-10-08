import { Card, Heading, Stack, Text } from "sid-ui";
import { FEATURES, LANDING_SECTIONS } from "@/lib/landing";
import { IconTile, LandingSection } from "./landing-section";

/** Features as a bento grid: the headline features span two columns. */
export function FeatureGrid() {
  return (
    <LandingSection
      id={LANDING_SECTIONS.features}
      eyebrow="Features"
      title="Everything between finding a job and getting the interview"
      description="Auto-bid, AI autofill, tailored ATS resumes, keyword match, Gmail reply sorting, and job search analytics in one account and one browser extension."
    >
      <div className="lp-bento">
        {FEATURES.map((feature) => (
          <div key={feature.title} className={feature.wide ? "lp-bento-wide" : undefined}>
            <Card padding={6} height="100%" className={feature.wide ? "lp-tile-glow" : undefined}>
              <Stack gap={5}>
                <IconTile icon={feature.icon} />
                <Stack gap={2}>
                  <Heading level={3}>{feature.title}</Heading>
                  <Text color="secondary" display="block">
                    {feature.description}
                  </Text>
                </Stack>
              </Stack>
            </Card>
          </div>
        ))}
      </div>
    </LandingSection>
  );
}
