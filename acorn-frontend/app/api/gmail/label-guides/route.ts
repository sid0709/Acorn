import { GMAIL_BACKEND, proxyGmailWrite } from "@/lib/gmail/backend";

/** Label descriptions saved for Autolabel. */
export function GET(request: Request) {
  return proxyGmailWrite(request, GMAIL_BACKEND.guides);
}

export function PUT(request: Request) {
  return proxyGmailWrite(request, GMAIL_BACKEND.guides);
}
