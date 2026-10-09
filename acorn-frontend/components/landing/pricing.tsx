import {
  Badge,
  Button,
  Card,
  Glyph,
  Grid,
  HStack,
  Heading,
  List,
  ListItem,
  Stack,
  Text,
} from "sid-ui";
import { PLANS, formatPrice, type PlanId } from "@/lib/billing";
import { LANDING_SECTIONS } from "@/lib/landing";
import { ROUTES } from "@/lib/routes";
import { LandingSection } from "./landing-section";

const PLAN_MIN_WIDTH = 260;
const PLAN_COLUMNS = 3;
/** The plan the page points an active job seeker to. */
const HIGHLIGHTED_PLAN: PlanId = "pro";

export function Pricing() {
  return (
    <LandingSection
      id={LANDING_SECTIONS.pricing}
      eyebrow="Pricing"
      title="Start auto-bidding free. Upgrade when your search picks up."
      description="Every plan includes the auto-bid agent, AI autofill, your profile, and job search analytics. No credit card to start."
    >
      <Grid columns={{ minWidth: PLAN_MIN_WIDTH, max: PLAN_COLUMNS }} gap={4}>
        {PLANS.map((plan) => {
          const highlighted = plan.id === HIGHLIGHTED_PLAN;
          const free = plan.price.monthly === 0;
          return (
            <Card
              key={plan.id}
              padding={6}
              variant={highlighted ? "blue" : "default"}
              elevation={highlighted ? "high" : undefined}
            >
              <Stack gap={5}>
                <Stack gap={1}>
                  <HStack hAlign="between" vAlign="center" gap={2}>
                    <Heading level={3}>{plan.name}</Heading>
                    {highlighted ? <Badge label="Recommended" variant="blue" /> : null}
                  </HStack>
                  <Text type="supporting" color="secondary">
                    {plan.tagline}
                  </Text>
                </Stack>
                <Stack gap={1}>
                  <HStack gap={1} vAlign="end">
                    <Text type="display-2">{formatPrice(plan.price.monthly)}</Text>
                    <Text color="secondary">/ month</Text>
                  </HStack>
                  <Text type="supporting" color="secondary">
                    {free
                      ? "Free forever"
                      : `${formatPrice(plan.price.yearly)} / month billed yearly`}
                  </Text>
                </Stack>
                <List density="compact">
                  {plan.features.map((feature) => (
                    <ListItem key={feature} label={feature} startContent={<Glyph name="check" />} />
                  ))}
                </List>
                <Button
                  label={free ? "Start free" : `Start with ${plan.name}`}
                  variant={highlighted ? "primary" : "secondary"}
                  href={ROUTES.signUp}
                />
              </Stack>
            </Card>
          );
        })}
      </Grid>
    </LandingSection>
  );
}
