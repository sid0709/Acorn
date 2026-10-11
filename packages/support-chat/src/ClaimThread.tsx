import { Fragment, useRef, useState, type ReactNode } from "react";
import {
  Avatar,
  ChatComposer,
  ChatComposerDrawer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  Glyph,
  HStack,
  IconButton,
  Link,
  Stack,
  Thumbnail,
  useFileDrop,
} from "sid-ui";

import { ATTACHMENT_ACCEPT, draftProblem } from "./form";
import { claimTitle, dayLabel, timeLabel } from "./format";
import { MessageAttachments } from "./MessageAttachments";
import { bubblePosition, threadItems } from "./runs";
import {
  CLAIM_AUTHOR,
  CLAIM_STATUS,
  MAX_ATTACHMENTS,
  MESSAGE_KIND,
  SUPPORT_NAME,
  type ClaimAuthor,
  type MessageDraft,
  type SupportAttachment,
  type SupportClaim,
  type SupportMessage,
} from "./types";
import { useDraftImages } from "./use-draft-images";

type ChatDensity = "compact" | "balanced" | "spacious";

/**
 * A claim's conversation as a chat: the report as its opening line, the
 * reporter's notes as the first message, then every reply, image, follow-up
 * page, and status change. The reader's own messages sit on the right. Images
 * attach from the picker, the clipboard, or a drop anywhere on the thread.
 * The composer clears once a message is sent.
 */
export function ClaimThread({
  claim,
  messages,
  viewer,
  onSend,
  attachmentSrc,
  density = "balanced",
  placeholder,
  emptyState,
  staffAvatar,
}: {
  claim: SupportClaim;
  messages: SupportMessage[];
  viewer: ClaimAuthor;
  /** Sends one message; reject to keep the draft and show the error. */
  onSend: (draft: MessageDraft) => Promise<void>;
  /** Where an attached image loads from; undefined while it is still on its way. */
  attachmentSrc: (attachment: SupportAttachment) => string | undefined;
  density?: ChatDensity;
  placeholder?: string;
  emptyState?: ReactNode;
  /** Shown beside support replies; initials are used when omitted. */
  staffAvatar?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const images = useDraftImages();
  const picker = useRef<HTMLInputElement>(null);
  const items = threadItems(claim, messages);
  const lastKind = messages[messages.length - 1]?.kind;

  const attach = (files: File[]) => setError(images.add(files));
  const { isDragging, dropProps } = useFileDrop({
    onFiles: attach,
    isDisabled: sending,
    hasPaste: true,
  });

  const send = async (text: string) => {
    const body = text.trim();
    const files = images.images.map((image) => image.file);
    if (sending) return;
    const problem = draftProblem(body, files);
    if (problem) {
      if (body || files.length) setError(problem);
      return;
    }
    setSending(true);
    setError("");
    try {
      await onSend({ body, files });
      setDraft("");
      images.clear();
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

  const bubbleContent = (message: SupportMessage) =>
    !message.pageUrl && !message.attachments?.length ? (
      message.body
    ) : (
      <Stack gap={2}>
        {message.pageUrl ? (
          <HStack gap={1} vAlign="center">
            <Glyph name="link" />
            <Link href={message.pageUrl} target="_blank" rel="noreferrer">
              {claimTitle({ pageTitle: message.pageTitle ?? "", pageUrl: message.pageUrl })}
            </Link>
          </HStack>
        ) : null}
        {message.attachments?.length ? (
          <MessageAttachments attachments={message.attachments} srcFor={attachmentSrc} />
        ) : null}
        {message.body || null}
      </Stack>
    );

  return (
    <Stack height="100%" data-dragging={isDragging ? "true" : undefined} {...dropProps}>
      <ChatLayout
        density={density}
        emptyState={emptyState}
        composer={
          <>
            <input
              ref={picker}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              hidden
              onChange={(event) => {
                attach(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
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
              drawer={
                images.images.length ? (
                  <ChatComposerDrawer>
                    <HStack gap={2} wrap="wrap">
                      {images.images.map((image) => (
                        <Thumbnail
                          key={image.key}
                          src={image.url}
                          alt={image.file.name || "Image to send"}
                          label={image.file.name || "Image to send"}
                          onRemove={() => images.remove(image.key)}
                          isDisabled={sending}
                        />
                      ))}
                    </HStack>
                  </ChatComposerDrawer>
                ) : undefined
              }
              footerActions={
                <IconButton
                  label="Attach images"
                  tooltip={`Attach up to ${MAX_ATTACHMENTS} images, or paste one`}
                  icon={<Glyph name="image" />}
                  variant="ghost"
                  isDisabled={sending || images.images.length >= MAX_ATTACHMENTS}
                  onClick={() => picker.current?.click()}
                />
              }
              status={error ? { type: "error", message: error } : undefined}
            />
          </>
        }
      >
        <ChatMessageList density={density}>
          <ChatSystemMessage variant="divider">{dayLabel(claim.createdAt)}</ChatSystemMessage>
          <ChatSystemMessage icon={<Glyph name="link" />}>
            <Link href={claim.pageUrl} target="_blank" rel="noreferrer">
              {`Reported ${claimTitle(claim)}`}
            </Link>
          </ChatSystemMessage>
          {items.map((item, index) => {
            const showDay = index > 0 && items[index - 1].day !== item.day;
            const divider = showDay ? (
              <ChatSystemMessage variant="divider">{item.day}</ChatSystemMessage>
            ) : null;
            if (item.type === "event") {
              const { message } = item;
              const resolved = message.kind === MESSAGE_KIND.resolved;
              const who = nameFor(message.author, message.authorName);
              return (
                <Fragment key={message.id}>
                  {divider}
                  <ChatSystemMessage icon={<Glyph name={resolved ? "check" : "refresh"} />}>
                    {`${resolved ? "Resolved" : "Reopened"} by ${who} · ${timeLabel(message.createdAt)}`}
                  </ChatSystemMessage>
                </Fragment>
              );
            }
            const isMine = item.author === viewer;
            const name = nameFor(item.author, item.name);
            const isStaff = item.author === CLAIM_AUTHOR.admin;
            const peerAvatar = isMine ? undefined : isStaff && staffAvatar ? (
              staffAvatar
            ) : (
              <Avatar name={name} size="sm" tooltip={false} />
            );
            return (
              <Fragment key={item.messages[0].id}>
                {divider}
                <ChatMessage
                  sender={isMine ? "user" : "assistant"}
                  density={density}
                  avatar={peerAvatar}
                >
                  {item.messages.map((message, position) => (
                    <ChatMessageBubble
                      key={message.id}
                      group={bubblePosition(position, item.messages.length)}
                      name={!isMine && position === 0 ? name : undefined}
                      metadata={
                        position === item.messages.length - 1 ? (
                          <ChatMessageMetadata timestamp={timeLabel(message.createdAt)} />
                        ) : undefined
                      }
                    >
                      {bubbleContent(message)}
                    </ChatMessageBubble>
                  ))}
                </ChatMessage>
              </Fragment>
            );
          })}
          {claim.status === CLAIM_STATUS.closed && lastKind !== MESSAGE_KIND.resolved ? (
            <ChatSystemMessage icon={<Glyph name="check" />}>
              Support marked this report resolved
            </ChatSystemMessage>
          ) : null}
        </ChatMessageList>
      </ChatLayout>
    </Stack>
  );
}
