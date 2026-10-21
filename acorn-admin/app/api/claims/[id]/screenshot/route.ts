import { claimPath } from "@/lib/api/claims";
import { adminFetch } from "@/lib/api/client";
import { resizedScreenshot, screenshotSizeFrom } from "@/lib/screenshot";

/** A claim's screenshots never change, so the browser may keep every size for good. */
const CACHE_CONTROL = "private, max-age=31536000, immutable";
const WEBP = "image/webp";

class MissingScreenshot extends Error {
  constructor(readonly status: number) {
    super("screenshot unavailable");
  }
}

/**
 * The claim's screenshot through the admin session, so the image never needs the token.
 * `?size=thumb` and `?size=view` are small WebP copies; the default is the original file.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const size = screenshotSizeFrom(new URL(request.url).searchParams.get("size"));
  const fetchOriginal = async () => {
    const res = await adminFetch(`${claimPath(id)}/screenshot`);
    if (!res.ok || !res.body) throw new MissingScreenshot(res.status);
    return res;
  };
  try {
    if (size === "original") {
      const res = await fetchOriginal();
      return new Response(res.body, {
        headers: {
          "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
          "Cache-Control": CACHE_CONTROL,
        },
      });
    }
    const bytes = await resizedScreenshot(id, size, async () =>
      Buffer.from(await (await fetchOriginal()).arrayBuffer()),
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
