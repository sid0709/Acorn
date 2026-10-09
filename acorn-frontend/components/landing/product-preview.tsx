import {
  Badge,
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
  type BadgeVariant,
} from "sid-ui";
import { AcornMark } from "@/components/brand/acorn-mark";
import { LandingSection } from "./landing-section";

/** Sample data for the showcase. It illustrates the product; it is not anyone's account. */
const SAMPLE_POSTING = {
  role: "Senior Product Designer",
  company: "Northwind",
  site: "Greenhouse",
};

const SAMPLE_FIELDS = [
  { label: "Full name", value: "Jordan Lee" },
  { label: "Email", value: "jordan.lee@example.com" },
  { label: "LinkedIn", value: "linkedin.com/in/jordanlee" },
  { label: "Work authorization", value: "Authorized to work in the US" },
  { label: "Years of experience", value: "7" },
  { label: "Why Northwind?", value: "Drafted from your profile and the posting" },
];
const SAMPLE_FIELD_TOTAL = 20;
const SAMPLE_FIELDS_FILLED = 18;

const SAMPLE_REPLIES: { company: string; subject: string; label: string; tone: BadgeVariant }[] = [
  { company: "Northwind", subject: "Interview availability", label: "Interview", tone: "blue" },
  { company: "Contoso", subject: "Take-home exercise", label: "Next step", tone: "purple" },
  { company: "Fabrikam", subject: "Your offer letter", label: "Offer", tone: "success" },
];

/** Headline numbers in plain text: a StatCard value is an <h2>, which would crowd the outline. */
const SAMPLE_STATS = [
  { label: "Bids this week", value: "42", hint: "Every one tracked in your statistics" },
  { label: "Reply rate", value: "18%", hint: "Counted from the Gmail inbox you connect" },
];

const SHOWCASE_ID = "see-it-work";

/** The extension's side panel mid-application, and the inbox it sorts afterwards. */
export function ProductPreview() {
  return (
    <LandingSection
      id={SHOWCASE_ID}
      eyebrow="See it work"
      title="The side panel that applies while you watch"
      description="Open any job posting and the Acorn side panel fills the application field by field, answers the screening questions, and sends the bid. Replies come back sorted."
    >
      <GridSystem gap={4} responsiveTo="viewport" align="stretch">
        <GridColumn span={12} lg={7}>
          <Card padding={6} elevation="high" height="100%" className="lp-console">
            <Stack gap={5}>
              <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
                <HStack gap={3} vAlign="center">
                  <AcornMark size="md" />
                  <Stack gap={0.5}>
                    <Heading level={3}>{SAMPLE_POSTING.role}</Heading>
                    <Text type="supporting" color="secondary">
                      {SAMPLE_POSTING.company} · {SAMPLE_POSTING.site}
                    </Text>
                  </Stack>
                </HStack>
                <Badge label="Auto-filling" variant="orange" icon={<Glyph name="sparkle" />} />
              </HStack>
              <ProgressBar
                label={`${SAMPLE_FIELDS_FILLED} of ${SAMPLE_FIELD_TOTAL} fields filled`}
                value={SAMPLE_FIELDS_FILLED}
                max={SAMPLE_FIELD_TOTAL}
              />
              <List density="compact" hasDividers>
                {SAMPLE_FIELDS.map((field) => (
                  <ListItem
                    key={field.label}
                    label={field.label}
                    description={field.value}
                    endContent={<Glyph name="check" />}
                  />
                ))}
              </List>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Badge label="Ready to bid" variant="success" icon={<Glyph name="send" />} />
                <Text type="supporting" color="secondary">
                  Send it now or review any answer first.
                </Text>
              </HStack>
            </Stack>
          </Card>
        </GridColumn>
        <GridColumn span={12} lg={5}>
          <Stack gap={4} height="100%">
            {SAMPLE_STATS.map((stat) => (
              <Card key={stat.label} padding={5}>
                <Stack gap={2}>
                  <HStack hAlign="between" vAlign="center">
                    <Text type="supporting" color="secondary">
                      {stat.label}
                    </Text>
                    <Badge label="Sample" variant="neutral" />
                  </HStack>
                  <Text className="lp-figure-value lp-gradient-text">{stat.value}</Text>
                  <Text type="supporting" color="secondary">
                    {stat.hint}
                  </Text>
                </Stack>
              </Card>
            ))}
            <Card padding={6}>
              <Stack gap={4}>
                <HStack gap={2} vAlign="center">
                  <Glyph name="mail" />
                  <Heading level={3}>Recruiter replies</Heading>
                </HStack>
                <List density="compact" hasDividers>
                  {SAMPLE_REPLIES.map((reply) => (
                    <ListItem
                      key={reply.company}
                      label={reply.company}
                      description={reply.subject}
                      endContent={<Badge label={reply.label} variant={reply.tone} />}
                    />
                  ))}
                </List>
              </Stack>
            </Card>
          </Stack>
        </GridColumn>
      </GridSystem>
    </LandingSection>
  );
}
