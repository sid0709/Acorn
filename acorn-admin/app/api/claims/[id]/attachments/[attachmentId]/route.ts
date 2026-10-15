import { claimPath } from "@/lib/api/claims";
import { adminFetch } from "@/lib/api/client";

/** An attachment never changes once sent, so the browser may keep it for good. */
const CACHE_CONTROL = "private, max-age=31536000, immutable";

/**
 * One image on a claim's message, through the admin session, so the image never needs the
 * token. `?size=thumb` is passed on: the backend answers with the small preview.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id, attachmentId } = await params;
  const { search } = new URL(request.url);
  const upstream = await adminFetch(
    `${claimPath(id)}/attachments/${encodeURIComponent(attachmentId)}${search}`,
  ).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    return new Response(null, { status: upstream?.status === 404 ? 404 : 502 });
  }
  const headers: Record<string, string> = {
    "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
    "Cache-Control": CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };
  // The backend's step timings reach the browser's Network panel next to the console's own.
  const timing = upstream.headers.get("Server-Timing");
  if (timing) headers["Server-Timing"] = timing;
  return new Response(upstream.body, { headers });
}
