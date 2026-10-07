import { Card, GridColumn, GridSystem, PageHeader, Skeleton, Stack } from "sid-ui";

const SIDEBAR_ROWS = 9;
const LIST_ROWS = 10;

/** The Gmail page's shape while the inbox streams in. */
export function GmailSkeleton() {
  return (
    <Stack gap={6}>
      <PageHeader
        title="Gmail"
        description="Your connected inbox, with its own labels. Acorn reads Gmail and never changes it."
      />
      <Card padding={0}>
        <GridSystem gap={0} align="stretch">
          <GridColumn span="full" lg={3}>
            <Stack gap={3} padding={5}>
              {Array.from({ length: SIDEBAR_ROWS }, (_, index) => (
                <Skeleton key={index} index={index} width="100%" height="2rem" />
              ))}
            </Stack>
          </GridColumn>
          <GridColumn span="full" lg={9}>
            <Stack gap={2} padding={5}>
              {Array.from({ length: LIST_ROWS }, (_, index) => (
                <Skeleton key={index} index={index} width="100%" height="2.5rem" />
              ))}
            </Stack>
          </GridColumn>
        </GridSystem>
      </Card>
    </Stack>
  );
}
