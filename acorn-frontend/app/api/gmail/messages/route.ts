import { GMAIL_BACKEND, proxyGmail } from "@/lib/gmail/backend";

/** One page of a Gmail label or search, for the inbox list. */
export function GET(request: Request) {
  return proxyGmail(request, GMAIL_BACKEND.messages, "list");
}
