import {
  Badge,
  Button,
  Card,
  Glyph,
  GridColumn,
  GridSystem,
  HStack,
  Heading,
  List,
  ListItem,
  ProgressBar,
  Stack,
  Text,
  Token,
} from "sid-ui";
import { LANDING_SECTIONS, RESUME_POINTS } from "@/lib/landing";
import { ROUTES } from "@/lib/routes";
import { LandingContainer } from "./landing-section";

/** Sample keyword match for the illustration beside the copy. */
const SAMPLE_MATCH = {
  role: "Senior Product Designer",
  covered: ["Figma", "Design systems", "User research", "Prototyping", "Stakeholder management"],
  missing: ["Accessibility", "A/B testing"],
};
const PERCENT = 100;

function matchPercent() {
  const total = SAMPLE_MATCH.covered.length + SAMPLE_MATCH.missing.length;
  return Math.round((SAMPLE_MATCH.covered.length / total) * PERCENT);
}

/** The resume builder pitch: copy and checklist on one side, a keyword match on the other. */
export function AtsResume() {
  const headingId = `${LANDING_SECTIONS.resume}-title`;
  const percent = matchPercent();
  return (
    <section id={LANDING_SECTIONS.resume} aria-labelledby={headingId} className="lp-section">
      <LandingContainer>
        <GridSystem gap={10} responsiveTo="viewport" align="center">
          <GridColumn span={12} lg={6}>
            <Stack gap={5}>
              <Stack gap={3} hAlign="start">
                <Badge label="ATS resume builder" variant="orange" />
                <Heading level={2} id={headingId} className="lp-title">
                  An ATS-friendly resume for every job you bid on
                </Heading>
                <Text color="secondary" display="block" className="lp-lede">
                  Most applications are read by an applicant tracking system before a recruiter sees
                  them. Before every bid, Acorn&apos;s AI resume builder tailors your resume to the
                  job description, so the keywords the ATS scans for are already there.
                </Text>
              </Stack>
              <List density="compact">
                {RESUME_POINTS.map((point) => (
                  <ListItem key={point} label={point} startContent={<Glyph name="check" />} />
                ))}
              </List>
              <HStack>
                <Button
                  label="Build your resume"
                  variant="primary"
                  icon={<Glyph name="file" />}
                  href={ROUTES.signUp}
                />
              </HStack>
            </Stack>
          </GridColumn>
          <GridColumn span={12} lg={6}>
            <Card padding={6} elevation="high" className="lp-console">
              <Stack gap={5}>
                <Stack gap={1}>
                  <Text type="supporting" color="secondary">
                    Keyword match · {SAMPLE_MATCH.role}
                  </Text>
                  <HStack gap={2} vAlign="center">
                    <Heading level={3} type="display-2">
                      {`${percent}%`}
                    </Heading>
                    <Badge label="Sample" variant="neutral" />
                  </HStack>
                </Stack>
                <ProgressBar label="Keywords covered" value={percent} isLabelHidden />
                <Stack gap={2}>
                  <Text weight="semibold">Covered</Text>
                  <HStack gap={2} wrap="wrap">
                    {SAMPLE_MATCH.covered.map((word) => (
                      <Token key={word} label={word} color="green" icon={<Glyph name="check" />} />
                    ))}
                  </HStack>
                </Stack>
                <Stack gap={2}>
                  <Text weight="semibold">Missing</Text>
                  <HStack gap={2} wrap="wrap">
                    {SAMPLE_MATCH.missing.map((word) => (
                      <Token key={word} label={word} color="orange" icon={<Glyph name="plus" />} />
                    ))}
                  </HStack>
                </Stack>
                <Text type="supporting" color="secondary" display="block">
                  Add the missing terms where they are true for you, and the draft covers every
                  requirement in the posting.
                </Text>
              </Stack>
            </Card>
          </GridColumn>
        </GridSystem>
      </LandingContainer>
    </section>
  );
}
