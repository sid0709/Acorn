import { Skeleton, Stack } from "sid-ui";

const BLOCKS = [
  { width: "16rem", height: "2rem" },
  { width: "100%", height: "12rem" },
  { width: "100%", height: "18rem" },
] as const;

/**
 * The shape of a workspace page while its data streams in: shown the moment a
 * link is clicked, so the click never sits on the previous page.
 */
export function SectionSkeleton() {
  return (
    <Stack gap={6}>
      {BLOCKS.map((block, index) => (
        <Skeleton key={block.height} index={index} width={block.width} height={block.height} />
      ))}
    </Stack>
  );
}
