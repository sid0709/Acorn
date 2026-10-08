import { Badge, Button, Glyph, HStack, Heading, Stack, Text } from "sid-ui";
import { AcornMark } from "@/components/brand/acorn-mark";
import { HERO_LEDE, POSITIONING, SLOGAN_LEAD, SLOGAN_PAYOFF } from "@/lib/landing";
import { ROUTES } from "@/lib/routes";
import { AgentConsole } from "./agent-console";
import { LandingContainer } from "./landing-section";

const REASSURANCES = ["Free plan", "No credit card", "Chrome, Edge, Brave, and Arc"];

/** The first screen: the slogan as the page's h1, the positioning, the ways in, and the agent at work. */
export function Hero({ installHref }: { installHref: string }) {
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <LandingContainer>
        <div className="lp-hero-grid">
          <Stack gap={6}>
            <HStack gap={2} wrap="wrap" className="lp-rise">
              <Badge label={POSITIONING} variant="orange" icon={<Glyph name="star" />} />
              <Badge label="AI agent" variant="blue" icon={<Glyph name="sparkle" />} />
            </HStack>
            <Heading level={1} id="hero-title" className="lp-display lp-rise">
              {SLOGAN_LEAD}{" "}
              <Text type="inherit" color="inherit" display="block" className="lp-gradient-text">
                {SLOGAN_PAYOFF}
              </Text>
            </Heading>
            <Text color="secondary" display="block" className="lp-lede lp-rise">
              {HERO_LEDE}
            </Text>
            <HStack gap={3} wrap="wrap" className="lp-rise">
              <Button
                label="Start auto-bidding free"
                variant="primary"
                size="lg"
                icon={<Glyph name="arrowRight" />}
                href={ROUTES.signUp}
              />
              <Button
                label="Add to Chrome"
                variant="secondary"
                size="lg"
                icon={<Glyph name="download" />}
                href={installHref}
              />
            </HStack>
            <HStack gap={5} wrap="wrap" className="lp-rise">
              {REASSURANCES.map((item) => (
                <HStack key={item} gap={1.5} vAlign="center">
                  <Glyph name="check" />
                  <Text type="supporting" color="secondary">
                    {item}
                  </Text>
                </HStack>
              ))}
            </HStack>
          </Stack>
          <div className="lp-hero-visual lp-rise">
            <span className="lp-hero-mark lp-float">
              <AcornMark variant="neon" size="xl" />
            </span>
            <AgentConsole />
          </div>
        </div>
      </LandingContainer>
    </section>
  );
}
