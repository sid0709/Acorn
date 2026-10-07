import { GMAIL_BACKEND, proxyGmailWrite } from "@/lib/gmail/backend";

/** Labels the messages selected in the Autolabel dialog. */
export function POST(request: Request) {
  return proxyGmailWrite(request, GMAIL_BACKEND.autolabel);
}
