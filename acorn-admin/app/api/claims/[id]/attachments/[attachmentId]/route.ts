import { claimPath } from "@/lib/api/claims";
import { adminFetch } from "@/lib/api/client";

/** An attachment never changes once sent, so the browser may keep it for good. */
const CACHE_CONTROL = "private, max-age=31536000, immutable";

/** One image on a claim's message, through the admin session, so the image never needs the token. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id, attachmentId } = await params;
  const upstream = await adminFetch(
    `${claimPath(id)}/attachments/${encodeURIComponent(attachmentId)}`,
  ).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    return new Response(null, { status: upstream?.status === 404 ? 404 : 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
