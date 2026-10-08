import { Glyph, Stack, Text } from "sid-ui";
import { PLANS } from "@/lib/billing";
import { AGENT_FLOW, JOB_SITES } from "@/lib/landing";
import { LandingContainer } from "./landing-section";

const FREE_BIDS = PLANS[0].limits.applications;

/** Every number here comes from the product's own definitions, not from a claim. */
const FIGURES = [
  { value: String(AGENT_FLOW.length), label: "steps of every application, automated" },
  { value: String(FREE_BIDS), label: "free auto-bids every month" },
  { value: `${JOB_SITES.length - 1}+`, label: "applicant tracking systems, one agent" },
  { value: "1", label: "profile that fills every application form" },
];

/** The job sites Acorn bids through, scrolling, then the headline figures. */
export function TrustStrip() {
  // The track holds the list twice so the loop is seamless; the copy is hidden from readers.
  return (
    <LandingContainer>
      <Stack gap={10}>
        <Stack gap={4} hAlign="center">
          <Text type="supporting" color="secondary" weight="semibold">
            Auto-bid on the applicant tracking systems employers use
          </Text>
          <div className="lp-marquee">
            <div className="lp-marquee-track">
              {[0, 1].map((copy) => (
                <ul
                  key={copy}
                  aria-hidden={copy === 1 ? true : undefined}
                  className="lp-marquee-list"
                >
                  {JOB_SITES.map((site) => (
                    <li key={site} className="lp-marquee-item">
                      <Glyph name="check" />
                      {site}
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </Stack>
        <dl className="lp-figures">
          {FIGURES.map((figure, index) => (
            <div
              key={figure.label}
              className="lp-figure lp-rise"
              style={{ ["--lp-index" as string]: index }}
            >
              <dt>
                <Text color="secondary">{figure.label}</Text>
              </dt>
              <dd className="lp-figure-value lp-gradient-text">{figure.value}</dd>
            </div>
          ))}
        </dl>
      </Stack>
    </LandingContainer>
  );
}
