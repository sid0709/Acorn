import { Skeleton, Stack } from "sid-ui";

const HEADER_HEIGHT = 56;
const BLOCK_HEIGHT = 240;

export default function Loading() {
  return (
    <Stack gap={4}>
      <Skeleton height={HEADER_HEIGHT} />
      <Skeleton height={BLOCK_HEIGHT} />
      <Skeleton height={BLOCK_HEIGHT} />
    </Stack>
  );
}
