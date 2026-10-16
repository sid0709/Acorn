/**
 * The Now card while an agent Run reads the applicant's Gmail for a code or link: the emails it
 * read, the chance the decision model gave each of being the one the site sent, and which one the
 * code or link came from. It stays after the search so a miss can be read: an email that arrived
 * before the site was asked is marked as such, since it cannot be the site's.
 */
import { MAIL_SEARCH_STATE, VERIFICATION, type MailSearch } from "@acorn/shared/run-types";
import { Badge, Glyph, HStack, Spinner, Text, VStack } from "sid-ui";

import { likeliestEmailId, senderName } from "../agent/mail-search";

/** The newest emails shown; the Logs tab keeps every look. */
const MAIL_SHOWN = 6;

const noun = (search: MailSearch) => (search.kind === VERIFICATION.emailLink ? "link" : "code");

const clock = (ms: number) =>
  ms > 0
    ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";

function heading(search: MailSearch): string {
  if (search.state === MAIL_SEARCH_STATE.found) return `Found the ${noun(search)} in your Gmail`;
  if (search.state === MAIL_SEARCH_STATE.missed) {
    return `Could not find the ${noun(search)} in your Gmail`;
  }
  return `Reading your Gmail for the ${noun(search)}`;
}

function subline(search: MailSearch): string {
  if (search.state === MAIL_SEARCH_STATE.missed && search.detail) return search.detail;
  const since = clock(search.since);
  const where = since ? `Only mail that arrived after ${since} can be the site's. ` : "";
  return `${where}Looked ${search.looks} time${search.looks === 1 ? "" : "s"}.`;
}

function EmailMark({
  email,
  chosen,
  likeliest,
}: {
  email: MailSearch["emails"][number];
  chosen: boolean;
  likeliest: boolean;
}) {
  if (chosen)
    return <Badge variant="green" label={`Used · ${Math.round(email.probability * 100)}%`} />;
  if (!email.after) return <Badge variant="neutral" label="Before the request" />;
  if (!email.judged) return <Badge variant="neutral" label="Waiting" />;
  return (
    <Badge
      variant={likeliest ? "green" : "neutral"}
      label={`${Math.round(email.probability * 100)}%`}
    />
  );
}

export function MailSearchPanel({ search }: { search: MailSearch }) {
  const likeliest = likeliestEmailId(search.emails);
  const shown = search.emails.slice(0, MAIL_SHOWN);
  const searching = search.state === MAIL_SEARCH_STATE.searching;
  return (
    <VStack gap={2} className="mail-search" aria-label="Gmail search">
      <HStack gap={2} align="center">
        {searching ? <Spinner label="Reading Gmail" /> : <Glyph name="mail" />}
        <Text type="supporting" weight="semibold">
          {heading(search)}
        </Text>
      </HStack>
      {search.shown ? (
        <Text size="sm" weight="semibold" hasTabularNumbers>
          {search.kind === VERIFICATION.emailLink ? "Link" : "Code"}: {search.shown}
        </Text>
      ) : null}
      <Text size="sm" color="secondary">
        {subline(search)}
      </Text>
      {shown.length ? (
        <VStack gap={1}>
          {shown.map((email) => (
            <HStack key={email.id} gap={2} align="center" justify="between" className="mail-row">
              <VStack gap={0} className="mail-row-text">
                <Text size="sm" weight="semibold" maxLines={1}>
                  {senderName(email.from)}
                </Text>
                <Text size="sm" color="secondary" maxLines={1}>
                  {email.subject} · {clock(email.receivedAt)}
                </Text>
              </VStack>
              <EmailMark
                email={email}
                chosen={email.id === search.chosenId}
                likeliest={email.id === likeliest}
              />
            </HStack>
          ))}
        </VStack>
      ) : (
        <Text size="sm" color="secondary">
          {searching ? "No mail read yet." : "No mail was read."}
        </Text>
      )}
    </VStack>
  );
}
