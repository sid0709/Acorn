import { Card, Grid, HStack, Heading, Stack, Text } from "sid-ui";
import { LANDING_SECTIONS, USE_CASES } from "@/lib/landing";
import { IconTile, LandingSection } from "./landing-section";

const CASE_MIN_WIDTH = 300;
const CASE_COLUMNS = 3;

export function UseCases() {
  return (
    <LandingSection
      id={LANDING_SECTIONS.useCases}
      eyebrow="Who it's for"
      title="Built for every job seeker who has better things to do than fill forms"
      description="Whether you are hunting for your first role or your next promotion, the auto-bid agent turns hours of applications into minutes."
    >
      <Grid columns={{ minWidth: CASE_MIN_WIDTH, max: CASE_COLUMNS }} gap={4}>
        {USE_CASES.map((useCase, index) => (
          <Card key={useCase.title} padding={6} variant="muted">
            <HStack gap={4} vAlign="start">
              <IconTile icon={useCase.icon} tone={index % 2 ? "orange" : "blue"} />
              <Stack gap={1}>
                <Heading level={3}>{useCase.title}</Heading>
                <Text color="secondary" display="block">
                  {useCase.description}
                </Text>
              </Stack>
            </HStack>
          </Card>
        ))}
      </Grid>
    </LandingSection>
  );
}
