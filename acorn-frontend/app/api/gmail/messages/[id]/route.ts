import { GMAIL_BACKEND, proxyGmail } from "@/lib/gmail/backend";

/** One full message for the reader. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyGmail(request, `${GMAIL_BACKEND.messages}/${encodeURIComponent(id)}`, "message");
}
