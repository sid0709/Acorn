import type { ImapFlow } from 'imapflow';
import { htmlToStructuredText } from '../lib/html-to-text';

export type LensImapBody = {
  uid: number;
  from: string;
  fromName: string;
  subject: string;
  date: Date | null;
  seen: boolean;
  bodyText: string;
};

type BodyStructureNode = {
  type?: string;
  encoding?: string;
  part?: string;
  childNodes?: BodyStructureNode[];
  parameters?: { charset?: string };
};

/** Prefer text/plain; fall back to text/html for plain-text extraction. */
export function findTextBodyPart(
  structure: BodyStructureNode | null | undefined,
  preferHtml = false,
): BodyStructureNode | null {
  if (!structure) return null;
  const want = preferHtml ? 'text/html' : 'text/plain';
  const type = String(structure.type || '').toLowerCase();
  if (type === want) {
    return { ...structure, part: structure.part || '1' };
  }
  for (const child of structure.childNodes || []) {
    const found = findTextBodyPart(child, preferHtml);
    if (found) return found;
  }
  return null;
}

async function readStreamText(
  stream: AsyncIterable<Buffer | Uint8Array> | null | undefined,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream || []) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

/**
 * One mailbox session: envelope + bodyStructure + text MIME part only.
 * Avoids full-message download/parse (attachments, nested MIME).
 */
export async function fetchTextBodyByUid(
  client: ImapFlow,
  uid: number,
  maxBytes = 100_000,
): Promise<LensImapBody | null> {
  const meta = await client.fetchOne(
    String(uid),
    {
      bodyStructure: true,
      envelope: true,
      flags: true,
      uid: true,
    },
    { uid: true },
  );
  if (!meta) return null;

  const structure = meta.bodyStructure as BodyStructureNode | undefined;
  const plainPart = findTextBodyPart(structure, false);
  const htmlPart = plainPart ? null : findTextBodyPart(structure, true);
  const partNode = plainPart || htmlPart;

  let bodyText = '';
  if (partNode?.part) {
    const part =
      partNode.part === '1' && !structure?.childNodes ? 'TEXT' : partNode.part;
    const download = await client.download(String(uid), part, {
      uid: true,
      maxBytes,
    });
    const raw = await readStreamText(download?.content);
    bodyText = htmlPart && !plainPart ? htmlToStructuredText(raw) : raw;
  } else {
    const fetched = await client.fetchOne(
      String(uid),
      { source: { maxLength: maxBytes }, uid: true },
      { uid: true },
    );
    const sourceBuf =
      fetched && typeof fetched === 'object' && 'source' in fetched
        ? fetched.source
        : null;
    if (sourceBuf) {
      const { simpleParser } = await import('mailparser');
      const parsed = await simpleParser(sourceBuf);
      bodyText =
        (typeof parsed.text === 'string' && parsed.text.trim()) ||
        (typeof parsed.html === 'string'
          ? htmlToStructuredText(parsed.html)
          : '');
    }
  }

  const from = meta.envelope?.from?.[0];
  return {
    uid: meta.uid,
    from: from?.address || '',
    fromName: from?.name || from?.address || '',
    subject: meta.envelope?.subject || '',
    date: meta.envelope?.date ?? null,
    seen: meta.flags?.has('\\Seen') ?? false,
    bodyText,
  };
}
