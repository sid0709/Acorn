import { Card, HStack, Heading, Stack, Text } from "sid-ui";
import { AGENT_FLOW, LANDING_SECTIONS } from "@/lib/landing";
import { IconTile, LandingSection } from "./landing-section";

/** The auto-bid agent's six steps, joined by a wire on wide screens. */
export function AgentFlow() {
  return (
    <LandingSection
      id={LANDING_SECTIONS.agent}
      eyebrow="How auto-bid works"
      title="One AI agent. Six steps. Every job application."
      description="Acorn runs the whole application for you, from reading the job description to tracking the recruiter's reply. You choose the jobs; the agent does the bidding."
    >
      <ol className="lp-flow">
        {AGENT_FLOW.map((step, index) => (
          <li key={step.id} className="lp-rise" style={{ ["--lp-index" as string]: index }}>
            <Card padding={5} height="100%">
              <Stack gap={4}>
                <HStack hAlign="between" vAlign="center">
                  <span className="lp-step-index">{index + 1}</span>
                  <IconTile icon={step.icon} tone={index % 2 ? "blue" : "orange"} />
                </HStack>
                <Stack gap={2}>
                  <Heading level={3}>{step.title}</Heading>
                  <Text color="secondary" display="block">
                    {step.description}
                  </Text>
                </Stack>
              </Stack>
            </Card>
          </li>
        ))}
      </ol>
    </LandingSection>
  );
}
