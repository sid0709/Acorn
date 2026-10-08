import { Skeleton, Stack } from "sid-ui";

const BLOCKS = [
  { width: "16rem", height: "2rem" },
  { width: "100%", height: "12rem" },
  { width: "100%", height: "18rem" },
] as const;

/** Shown at once while a workspace page streams, so a click does not sit on the previous page. */
export default function WorkspaceLoading() {
  return (
    <Stack gap={6}>
      {BLOCKS.map((block, index) => (
        <Skeleton key={block.height} index={index} width={block.width} height={block.height} />
      ))}
    </Stack>
  );
}
