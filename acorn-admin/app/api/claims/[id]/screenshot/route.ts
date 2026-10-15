import { claimPath } from "@/lib/api/claims";
import { adminFetch } from "@/lib/api/client";
import { resizedScreenshot, screenshotSizeFrom } from "@/lib/screenshot";

/** A claim's screenshots never change, so the browser may keep every size for good. */
const CACHE_CONTROL = "private, max-age=31536000, immutable";
const WEBP = "image/webp";
/** acorn-backend's query for the small preview it keeps beside the screenshot (imageSizeParam). */
const THUMB_QUERY = "?size=thumb";

class MissingScreenshot extends Error {
  constructor(readonly status: number) {
    super("screenshot unavailable");
  }
}

/**
 * The claim's screenshot through the admin session, so the image never needs the token.
 * `?size=thumb` is the preview acorn-backend made when the claim was filed; `?size=view` is a
 * WebP sized for the viewer; the default is the original file.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const size = screenshotSizeFrom(new URL(request.url).searchParams.get("size"));
  const fetchImage = async (query = "") => {
    const res = await adminFetch(`${claimPath(id)}/screenshot${query}`);
    if (!res.ok || !res.body) throw new MissingScreenshot(res.status);
    return res;
  };
  try {
    if (size !== "view") {
      const res = await fetchImage(size === "thumb" ? THUMB_QUERY : "");
      const headers: Record<string, string> = {
        "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": CACHE_CONTROL,
      };
      const timing = res.headers.get("Server-Timing");
      if (timing) headers["Server-Timing"] = timing;
      return new Response(res.body, { headers });
    }
    const bytes = await resizedScreenshot(id, async () =>
      Buffer.from(await (await fetchImage()).arrayBuffer()),
    );
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": WEBP, "Cache-Control": CACHE_CONTROL },
    });
  } catch (err) {
    return new Response(null, {
      status: err instanceof MissingScreenshot && err.status === 404 ? 404 : 502,
    });
  }
}
