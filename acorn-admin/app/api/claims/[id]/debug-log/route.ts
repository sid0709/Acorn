import { claimPath } from "@/lib/api/claims";
import { adminFetch } from "@/lib/api/client";

/**
 * The claim's debug-run log through the admin session, as a zip.
 * A follow-up can add files later, so this response is not cached.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await adminFetch(`${claimPath(id)}/debug-log`).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    return new Response(null, { status: upstream?.status === 404 ? 404 : 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition":
        upstream.headers.get("Content-Disposition") ?? 'attachment; filename="acorn-debug-log.zip"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
