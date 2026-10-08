import { Badge, Button, Card, Glyph, HStack, Heading, Stack, Text } from "sid-ui";
import { CONTROL_POINTS } from "@/lib/landing";
import { ROUTES } from "@/lib/routes";
import { IconTile, LandingContainer } from "./landing-section";

const BAND_ID = "you-stay-in-control";

/** The dark band: an AI agent that bids for you, on your terms. */
export function AgentBand() {
  const headingId = `${BAND_ID}-title`;
  return (
    <section id={BAND_ID} aria-labelledby={headingId} className="lp-section">
      <LandingContainer>
        <div className="lp-band">
          <div className="lp-band-grid">
            <Stack gap={5}>
              <HStack>
                <Badge label="AI agent, your rules" variant="orange" icon={<Glyph name="lock" />} />
              </HStack>
              <Heading level={2} id={headingId} color="inherit" className="lp-title lp-on-dark">
                An AI agent that works for you, not around you
              </Heading>
              <Text display="block" className="lp-lede lp-on-dark-muted">
                Most auto-apply bots spray the same resume everywhere. Acorn bids like you would:
                one posting at a time, a resume written for that job, answers from your own profile,
                and every step visible in the side panel.
              </Text>
              <HStack gap={3} wrap="wrap">
                <Button
                  label="Put the agent to work"
                  variant="primary"
                  size="lg"
                  icon={<Glyph name="arrowRight" />}
                  href={ROUTES.signUp}
                />
              </HStack>
            </Stack>
            <Stack gap={3}>
              {CONTROL_POINTS.map((point) => (
                <Card key={point.title} padding={5} className="lp-glass">
                  <HStack gap={4} vAlign="start">
                    <IconTile icon={point.icon} />
                    <Stack gap={1}>
                      <Heading level={3} color="inherit" className="lp-on-dark">
                        {point.title}
                      </Heading>
                      <Text display="block" className="lp-on-dark-muted">
                        {point.description}
                      </Text>
                    </Stack>
                  </HStack>
                </Card>
              ))}
            </Stack>
          </div>
        </div>
      </LandingContainer>
    </section>
  );
}
