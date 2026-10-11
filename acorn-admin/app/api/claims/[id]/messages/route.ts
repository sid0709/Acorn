import { claimPath } from "@/lib/api/claims";
import { adminFetch } from "@/lib/api/client";

/**
 * Sends a reply, images included, through the admin session. The multipart body goes on
 * to acorn-backend as it came; a server action would cap it at a megabyte.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await adminFetch(`${claimPath(id)}/messages`, {
    method: "POST",
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
    body: await request.arrayBuffer(),
  }).catch(() => null);
  if (!upstream) return Response.json({ error: "Couldn’t reach Acorn" }, { status: 502 });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
}
