import { Button, Glyph, HStack, Heading, PAGE_WIDTHS, Stack, Text } from "sid-ui";
import { AcornMark } from "@/components/brand/acorn-mark";
import { SLOGAN_LEAD } from "@/lib/landing";
import { INSTALL_SECTION_ID, ROUTES } from "@/lib/routes";
import { LandingContainer } from "./landing-section";
import { SloganPayoff } from "./slogan-payoff";

/** The closing call to action, and the in-page install target when there is no store listing. */
export function FinalCta({
  installHref,
  downloadUrl,
}: {
  installHref: string;
  downloadUrl: string | null;
}) {
  const headingId = `${INSTALL_SECTION_ID}-title`;
  return (
    <section id={INSTALL_SECTION_ID} aria-labelledby={headingId} className="lp-section">
      <LandingContainer>
        <div className="lp-cta">
          <Stack gap={6} hAlign="center">
            <span className="lp-float">
              <AcornMark variant="neon" size="lg" />
            </span>
            <Stack gap={4} hAlign="center" maxWidth={PAGE_WIDTHS.narrow}>
              <Heading
                level={2}
                id={headingId}
                color="inherit"
                justify="center"
                className="lp-title"
              >
                {SLOGAN_LEAD} <SloganPayoff />
              </Heading>
              <Text display="block" justify="center" className="lp-lede lp-on-dark-muted">
                Create a free account, add the extension, and let the auto-bid agent send your next
                application while you prepare for the interview.
              </Text>
            </Stack>
            <HStack gap={3} wrap="wrap" hAlign="center">
              <Button
                label="Start auto-bidding free"
                variant="primary"
                size="lg"
                icon={<Glyph name="arrowRight" />}
                href={ROUTES.signUp}
              />
              <Button
                label={downloadUrl ? "Download for Chrome" : "Add to Chrome"}
                variant="secondary"
                size="lg"
                icon={<Glyph name="download" />}
                href={downloadUrl ?? installHref}
              />
            </HStack>
            <Text type="supporting" justify="center" display="block" className="lp-on-dark-muted">
              Sign in on this site in the same browser, then open the Acorn side panel and choose
              Continue.
            </Text>
          </Stack>
        </div>
      </LandingContainer>
    </section>
  );
}
