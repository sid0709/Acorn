import { decodeMimePartText } from '../../mail/lib/decode-mime-text';
import { extractVerificationCode } from '../lib/verification-code';

const MAX_MESSAGE_TEXT_LENGTH = 100_000;
const URL_IN_TEXT = /(https?:\/\/[^\s]+)/g;

export type LensGmailRawMessage = {
  uid: number;
  from: string;
  fromName: string;
  subject: string;
  date: Date | string | null;
  seen: boolean;
  bodyText?: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Split body into readable paragraphs; isolate long URLs when needed. */
export function paragraphs(value: string): string[] {
  const normalized = text(value).replace(/\r\n?/g, '\n');
  if (!normalized) return [];

  let blocks = normalized
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length <= 1) {
    const soft = normalized
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (soft.length > 1) blocks = soft;
  }

  blocks = blocks.flatMap(splitAroundHttpUrls);
  return blocks.length ? blocks : [normalized];
}

function splitAroundHttpUrls(block: string): string[] {
  URL_IN_TEXT.lastIndex = 0;
  if (!URL_IN_TEXT.test(block)) return [block];
  URL_IN_TEXT.lastIndex = 0;
  const parts = block
    .replace(URL_IN_TEXT, '\n$1\n')
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [block];
}

function isoDate(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : new Date(value || '');
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

/** Envelope-only message for the Lens inbox list (body loaded later). */
export function mapLensGmailEnvelope(message: LensGmailRawMessage) {
  const subject = text(message.subject) || '(No subject)';
  const securityCode = extractVerificationCode(subject);
  const senderEmail = text(message.from);
  return {
    id: String(message.uid || ''),
    sender: text(message.fromName) || senderEmail || 'Unknown sender',
    senderEmail,
    subject,
    preview: '',
    receivedAt: isoDate(message.date),
    isUnread: message.seen !== true,
    kind: securityCode ? ('security-code' as const) : ('general' as const),
    ...(securityCode ? { securityCode } : {}),
    body: [] as string[],
    bodyLoaded: false,
  };
}

/** Full message with body paragraphs for Lens message detail. */
export function mapLensGmailMessage(message: LensGmailRawMessage) {
  const bodyText = decodeMimePartText(text(message.bodyText)).slice(
    0,
    MAX_MESSAGE_TEXT_LENGTH,
  );
  const subject = text(message.subject) || '(No subject)';
  const securityCode = extractVerificationCode(`${subject}\n${bodyText}`);
  const previewSource = bodyText.replace(/\s+/g, ' ') || subject;
  const senderEmail = text(message.from);

  return {
    id: String(message.uid || ''),
    sender: text(message.fromName) || senderEmail || 'Unknown sender',
    senderEmail,
    subject,
    preview: previewSource.slice(0, 160),
    receivedAt: isoDate(message.date),
    isUnread: message.seen !== true,
    kind: securityCode ? ('security-code' as const) : ('general' as const),
    ...(securityCode ? { securityCode } : {}),
    body: paragraphs(bodyText),
    bodyLoaded: true,
  };
}
