import { Fragment, useState, type ReactNode } from "react";
import {
  Avatar,
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  Glyph,
  Link,
  Stack,
} from "sid-ui";

import { claimTitle, dayLabel, timeLabel } from "./format";
import { bubblePosition, messageRuns } from "./runs";
import {
  CLAIM_AUTHOR,
  CLAIM_STATUS,
  MAX_MESSAGE_LENGTH,
  SUPPORT_NAME,
  type ClaimAuthor,
  type SupportClaim,
  type SupportMessage,
} from "./types";

type ChatDensity = "compact" | "balanced" | "spacious";

/**
 * A claim's conversation as a chat: the report as its opening line, the
 * reporter's notes as the first message, then every reply. The reader's own
 * messages sit on the right. The composer clears once a message is sent.
 */
export function ClaimThread({
  claim,
  messages,
  viewer,
  onSend,
  density = "balanced",
  placeholder,
  emptyState,
}: {
  claim: SupportClaim;
  messages: SupportMessage[];
  viewer: ClaimAuthor;
  /** Sends one message; reject to keep the draft and show the error. */
  onSend: (body: string) => Promise<void>;
  density?: ChatDensity;
  placeholder?: string;
  emptyState?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const runs = messageRuns(claim, messages);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    if (body.length > MAX_MESSAGE_LENGTH) {
      setError(`Keep messages under ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`);
      return;
    }
    setSending(true);
    setError("");
    try {
      await onSend(body);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const nameFor = (author: ClaimAuthor, name: string) =>
    author === CLAIM_AUTHOR.admin
      ? name || SUPPORT_NAME
      : name || claim.userName || claim.userEmail;

  return (
    <Stack height="100%">
      <ChatLayout
        density={density}
        emptyState={emptyState}
        composer={
          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSubmit={(text) => void send(text)}
            isDisabled={sending}
            density={density}
            placeholder={
              placeholder ??
              (claim.status === CLAIM_STATUS.closed && viewer === CLAIM_AUTHOR.user
                ? "Reply to reopen this report"
                : "Write a message")
            }
            status={error ? { type: "error", message: error } : undefined}
          />
        }
      >
        <ChatMessageList density={density}>
          <ChatSystemMessage variant="divider">{dayLabel(claim.createdAt)}</ChatSystemMessage>
          <ChatSystemMessage icon={<Glyph name="link" />}>
            <Link href={claim.pageUrl} target="_blank" rel="noreferrer">
              {`Reported ${claimTitle(claim)}`}
            </Link>
          </ChatSystemMessage>
          {runs.map((run, index) => {
            const isMine = run.author === viewer;
            const name = nameFor(run.author, run.name);
            const showDay = index > 0 && runs[index - 1].day !== run.day;
            return (
              <Fragment key={run.messages[0].id}>
                {showDay ? (
                  <ChatSystemMessage variant="divider">{run.day}</ChatSystemMessage>
                ) : null}
                <ChatMessage
                  sender={isMine ? "user" : "assistant"}
                  density={density}
                  avatar={isMine ? undefined : <Avatar name={name} size="sm" tooltip={false} />}
                >
                  {run.messages.map((message, position) => (
                    <ChatMessageBubble
                      key={message.id}
                      group={bubblePosition(position, run.messages.length)}
                      name={!isMine && position === 0 ? name : undefined}
                      metadata={
                        position === run.messages.length - 1 ? (
                          <ChatMessageMetadata timestamp={timeLabel(message.createdAt)} />
                        ) : undefined
                      }
                    >
                      {message.body}
                    </ChatMessageBubble>
                  ))}
                </ChatMessage>
              </Fragment>
            );
          })}
          {claim.status === CLAIM_STATUS.closed ? (
            <ChatSystemMessage icon={<Glyph name="check" />}>
              Support closed this report
            </ChatSystemMessage>
          ) : null}
        </ChatMessageList>
      </ChatLayout>
    </Stack>
  );
}
