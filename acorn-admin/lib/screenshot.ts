import sharp from "sharp";

export const SCREENSHOT_SIZES = ["thumb", "view", "original"] as const;
export type ScreenshotSize = (typeof SCREENSHOT_SIZES)[number];

export function screenshotSizeFrom(raw: string | null): ScreenshotSize {
  return SCREENSHOT_SIZES.find((size) => size === raw) ?? "original";
}

/** The viewer's copy: as wide as a laptop column needs, however long the page is. */
const VIEW_WIDTH = 1100;
const VIEW_QUALITY = 78;
/** Processed copies kept in memory, oldest out first. */
const CACHE_MAX_ENTRIES = 64;

const processed = new Map<string, Buffer>();

function remember(key: string, bytes: Buffer) {
  processed.set(key, bytes);
  if (processed.size > CACHE_MAX_ENTRIES) {
    const oldest = processed.keys().next().value;
    if (oldest !== undefined) processed.delete(oldest);
  }
}

/**
 * The viewer's WebP of a full-page screenshot; repeat requests come from memory. The small
 * thumbnail is not made here: acorn-backend keeps it beside the screenshot.
 */
export async function resizedScreenshot(
  id: string,
  source: () => Promise<Buffer>,
): Promise<Buffer> {
  const hit = processed.get(id);
  if (hit) return hit;
  const bytes = await sharp(await source(), { limitInputPixels: false })
    .resize({ width: VIEW_WIDTH, withoutEnlargement: true })
    .webp({ quality: VIEW_QUALITY })
    .toBuffer();
  remember(id, bytes);
  return bytes;
}
