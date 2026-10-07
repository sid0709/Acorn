import { claimPath } from "@/lib/api/claims";
import { adminFetch } from "@/lib/api/client";

/** The claim's screenshot through the admin session, so the image never needs the token. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await adminFetch(`${claimPath(id)}/screenshot`);
  if (!res.ok || !res.body) {
    return new Response(null, { status: res.status === 404 ? 404 : 502 });
  }
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
