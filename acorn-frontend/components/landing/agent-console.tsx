import {
  Badge,
  Card,
  Divider,
  Glyph,
  HStack,
  Heading,
  List,
  ListItem,
  ProgressBar,
  Stack,
  StatusDot,
  Text,
  type BadgeVariant,
} from "sid-ui";
import { AcornMark } from "@/components/brand/acorn-mark";

/** Sample activity for the hero illustration. It shows the product; it is nobody's account. */
const SAMPLE_BIDS: {
  role: string;
  company: string;
  site: string;
  status: string;
  tone: BadgeVariant;
}[] = [
  {
    role: "Senior Frontend Engineer",
    company: "Northwind",
    site: "Greenhouse",
    status: "Bid sent",
    tone: "success",
  },
  {
    role: "Product Designer",
    company: "Contoso",
    site: "Lever",
    status: "Filling",
    tone: "orange",
  },
  {
    role: "Data Analyst",
    company: "Fabrikam",
    site: "Workday",
    status: "Tailoring resume",
    tone: "blue",
  },
  { role: "AI Engineer", company: "Tailspin", site: "Ashby", status: "Queued", tone: "neutral" },
];
const SAMPLE_DAILY_BIDS = 24;
const SAMPLE_DAILY_GOAL = 30;

/** The hero's right side: the auto-bid agent working through a queue of postings. */
export function AgentConsole() {
  return (
    <Card padding={6} elevation="high" className="lp-console">
      <Stack gap={5}>
        <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
          <HStack gap={3} vAlign="center">
            <AcornMark size="md" />
            <Stack gap={0.5}>
              <Heading level={3}>Auto-bid agent</Heading>
              <Text type="supporting" color="secondary">
                Working through today&apos;s postings
              </Text>
            </Stack>
          </HStack>
          <HStack gap={2} vAlign="center">
            <StatusDot variant="success" label="Running" isPulsing />
            <Text type="supporting" weight="semibold">
              Running
            </Text>
          </HStack>
        </HStack>
        <ProgressBar
          label={`${SAMPLE_DAILY_BIDS} of ${SAMPLE_DAILY_GOAL} bids today`}
          value={SAMPLE_DAILY_BIDS}
          max={SAMPLE_DAILY_GOAL}
        />
        <List density="compact" hasDividers>
          {SAMPLE_BIDS.map((bid) => (
            <ListItem
              key={bid.role}
              label={bid.role}
              description={`${bid.company} · ${bid.site}`}
              endContent={<Badge label={bid.status} variant={bid.tone} />}
            />
          ))}
        </List>
        <Divider />
        <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
          <HStack gap={2} vAlign="center">
            <Glyph name="sparkle" />
            <Text type="supporting" color="secondary">
              Resume tailored and 14 fields filled on the last bid
            </Text>
          </HStack>
          <Badge label="Sample" variant="neutral" />
        </HStack>
      </Stack>
    </Card>
  );
}
