import sharp from "sharp";

export const SCREENSHOT_SIZES = ["thumb", "view", "original"] as const;
export type ScreenshotSize = (typeof SCREENSHOT_SIZES)[number];

export function screenshotSizeFrom(raw: string | null): ScreenshotSize {
  return SCREENSHOT_SIZES.find((size) => size === raw) ?? "original";
}

/** The thumbnail is the top of the page: this wide, cropped to this tall. */
const THUMB_WIDTH = 480;
const THUMB_HEIGHT = 360;
/** The viewer's copy: as wide as a laptop column needs, however long the page is. */
const VIEW_WIDTH = 1100;
const THUMB_QUALITY = 70;
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

/** A smaller WebP of a full-page screenshot; repeat requests come from memory. */
export async function resizedScreenshot(
  id: string,
  size: Exclude<ScreenshotSize, "original">,
  source: () => Promise<Buffer>,
): Promise<Buffer> {
  const key = `${id}:${size}`;
  const hit = processed.get(key);
  if (hit) return hit;
  const image = sharp(await source(), { limitInputPixels: false });
  const bytes =
    size === "thumb"
      ? await image
          .resize({ width: THUMB_WIDTH, height: THUMB_HEIGHT, fit: "cover", position: "top" })
          .webp({ quality: THUMB_QUALITY })
          .toBuffer()
      : await image
          .resize({ width: VIEW_WIDTH, withoutEnlargement: true })
          .webp({ quality: VIEW_QUALITY })
          .toBuffer();
  remember(key, bytes);
  return bytes;
}
