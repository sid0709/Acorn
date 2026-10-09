import { Card, Heading, Stack, Text, Token } from "sid-ui";
import { KEYWORD_GROUPS } from "@/lib/keywords";
import { LANDING_SECTIONS } from "@/lib/landing";
import { LandingSection } from "./landing-section";

/** What people search for when they need Acorn, grouped the way they search. */
export function Topics() {
  return (
    <LandingSection
      id={LANDING_SECTIONS.topics}
      eyebrow="One tool, every job search task"
      title="Auto-bid, AI agent, ATS resume, and job tracker in one"
      description="Whatever you call it, an auto apply bot, an AI job application assistant, or a job search copilot, Acorn covers it."
    >
      <div className="lp-topics">
        {KEYWORD_GROUPS.map((group) => (
          <Card key={group.id} padding={6}>
            <Stack gap={4}>
              <Stack gap={1}>
                <Heading level={3}>{group.title}</Heading>
                <Text color="secondary" display="block">
                  {group.description}
                </Text>
              </Stack>
              <ul className="lp-token-list">
                {group.terms.map((term) => (
                  <li key={term}>
                    <Token label={term} size="sm" />
                  </li>
                ))}
              </ul>
            </Stack>
          </Card>
        ))}
      </div>
    </LandingSection>
  );
}
