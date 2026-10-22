import type { FetchMessageObject, ImapFlow } from 'imapflow';
import { decodeMimePartText } from '../lib/decode-mime-text';
import { htmlToStructuredText } from '../lib/html-to-text';
import {
  fetchTextBodyByUid,
  findTextBodyPart,
  type LensImapBody,
} from './imap-text-body';

/**
 * One mailbox session: UID-set FETCH of envelope + truncated TEXT/1 parts.
 * Falls back to per-UID download when a message has no usable body part.
 */
export async function fetchTextBodiesByUids(
  client: ImapFlow,
  uids: number[],
  maxBytes = 100_000,
): Promise<LensImapBody[]> {
  if (!uids.length) return [];
  const found = new Map<number, LensImapBody>();

  for await (const message of client.fetch(
    uids,
    {
      uid: true,
      flags: true,
      envelope: true,
      bodyStructure: true,
      bodyParts: [
        { key: 'TEXT', maxLength: maxBytes },
        { key: '1', maxLength: maxBytes },
      ],
    },
    { uid: true },
  )) {
    const row = fromFetchedMessage(message, maxBytes);
    if (row?.bodyText) found.set(row.uid, row);
  }

  for (const uid of uids) {
    if (found.has(uid)) continue;
    const row = await fetchTextBodyByUid(client, uid, maxBytes);
    if (row) found.set(uid, row);
  }

  return uids.flatMap((uid) => {
    const row = found.get(uid);
    return row ? [row] : [];
  });
}

function fromFetchedMessage(
  message: FetchMessageObject,
  maxBytes: number,
): LensImapBody | null {
  const uid = Number(message.uid);
  if (!Number.isSafeInteger(uid) || uid <= 0) return null;

  const structure = message.bodyStructure;
  const plainPart = findTextBodyPart(structure, false);
  const htmlPart = plainPart ? null : findTextBodyPart(structure, true);
  const partNode = plainPart || htmlPart;
  const partKey =
    plainPart?.part === '1' && !structure?.childNodes
      ? 'TEXT'
      : String(partNode?.part || 'TEXT');
  const raw =
    partText(message, partKey, maxBytes) ||
    partText(message, 'TEXT', maxBytes) ||
    partText(message, '1', maxBytes);
  if (!raw) return null;

  const decoded = decodeMimePartText(raw, {
    encoding: partNode?.encoding,
    charset: partNode?.parameters?.charset,
  });
  const bodyText =
    htmlPart && !plainPart ? htmlToStructuredText(decoded) : decoded;
  if (!bodyText) return null;

  const from = message.envelope?.from?.[0];
  return {
    uid,
    from: from?.address || '',
    fromName: from?.name || from?.address || '',
    subject: message.envelope?.subject || '',
    date: message.envelope?.date ?? null,
    seen: message.flags?.has('\\Seen') ?? false,
    bodyText,
  };
}

function partText(
  message: FetchMessageObject,
  key: string,
  maxBytes: number,
): string {
  const buf = message.bodyParts?.get(key);
  if (!buf?.length) return '';
  const sliced = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;
  return sliced.toString('latin1');
}
