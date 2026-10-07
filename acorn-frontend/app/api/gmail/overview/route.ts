import { GMAIL_BACKEND, proxyGmail } from "@/lib/gmail/backend";

/** The mailbox's Google profile and labels with counts, for the sidebar. */
export function GET(request: Request) {
  return proxyGmail(request, GMAIL_BACKEND.overview, "list");
}
