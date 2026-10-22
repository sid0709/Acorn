import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import PizZip from 'pizzip';
import {
  classifyHeading,
  cleanString,
  fuzzyCompanyMatch,
  hasBullet,
  isBoldPara,
  isItalicPara,
  looksLikeTitleDateLine,
  paraText,
  stripNamespaces,
} from './parse-template-heading';
import { findPlaceholders } from './parse-template-tokens';
import type {
  ResumeTemplateSlot,
  TemplateIdentity,
} from '../mappers/resume-template.mapper';

export type ParseTemplateResult = {
  slotCount: number;
  sectionsFound: string[];
  slots: ResumeTemplateSlot[];
  warnings: string[];
};

type Block = {
  index: number;
  el: Element;
  text: string;
  isHeading: boolean;
  sectionHeading: string | null;
  isBullet: boolean;
};

function extractCompanyHint(
  $: CheerioAPI,
  blocks: Block[],
  slotParaIndex: number,
): string | undefined {
  const same = blocks[slotParaIndex];
  const fromSame = same?.text
    ?.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, '')
    .replace(/[—–-]/g, ' ')
    .trim();
  if (fromSame && !looksLikeTitleDateLine(fromSame) && fromSame.length < 80) {
    return cleanString(fromSame);
  }
  for (let i = slotParaIndex - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (findPlaceholders(b.text).length) break;
    if (b.sectionHeading === 'experience') break;
    if (looksLikeTitleDateLine(b.text) && isBoldPara($, b.el)) continue;
    if (isItalicPara($, b.el)) return cleanString(b.text);
    if (b.text && !looksLikeTitleDateLine(b.text) && !b.isHeading) {
      return cleanString(b.text);
    }
  }
  return undefined;
}

function classifySlotSection(blocks: Block[], slotParaIndex: number): string {
  for (let i = slotParaIndex - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b.sectionHeading && b.sectionHeading !== 'education')
      return b.sectionHeading;
    if (b.isHeading) {
      const cls = classifyHeading(b.text);
      if (cls && cls !== 'education') return cls;
    }
  }
  return 'summary';
}

/** Parse a DOCX buffer and return slot manifest for `{}` / `{token}` placeholders. */
export function parseTemplateDocx(
  buffer: Buffer,
  identity: TemplateIdentity = {},
): ParseTemplateResult {
  const zip = new PizZip(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Invalid DOCX: missing word/document.xml');

  const xml = docFile.asText();
  const $ = cheerio.load(stripNamespaces(xml), {
    xml: { decodeEntities: false },
  });

  const blocks: Block[] = [];
  $('p').each((idx, el) => {
    const text = paraText($, el);
    const headingCls = classifyHeading(text);
    const isHeading = Boolean(headingCls) && text.length < 80;
    blocks.push({
      index: idx,
      el,
      text,
      isHeading,
      sectionHeading: isHeading ? headingCls : null,
      isBullet: hasBullet($, el),
    });
  });

  const warnings: string[] = [];
  const slots: ResumeTemplateSlot[] = [];
  const careers = Array.isArray(identity.careers) ? identity.careers : [];

  for (const b of blocks) {
    const placeholders = findPlaceholders(b.text);
    if (!placeholders.length) continue;
    for (const ph of placeholders) {
      const section =
        ph.kind === 'anonymous'
          ? classifySlotSection(blocks, b.index)
          : ph.section;
      const slot: ResumeTemplateSlot = {
        index: slots.length,
        paragraphIndex: b.index,
        section,
        isBullet: b.isBullet,
        token: ph.token,
        kind: ph.kind,
      };
      if (section === 'experience') {
        slot.companyHint = extractCompanyHint($, blocks, b.index);
        if (ph.experienceIndex != null)
          slot.experienceIndex = ph.experienceIndex;
        else {
          const matchIdx = careers.findIndex((c) =>
            fuzzyCompanyMatch(c?.company, slot.companyHint),
          );
          if (matchIdx >= 0) slot.experienceIndex = matchIdx;
        }
      }
      slots.push(slot);
    }
  }

  if (!slots.length) {
    throw new Error(
      'Template must contain at least one {placeholder} such as {summary} or {}.',
    );
  }

  const sectionsFound = [
    ...new Set(
      slots
        .map((s) => s.section)
        .filter((s) => s && s !== 'education' && s !== 'title'),
    ),
  ];
  for (const sec of ['summary', 'skills', 'experience']) {
    if (!sectionsFound.includes(sec)) {
      warnings.push(`No placeholder found in ${sec} section.`);
    }
  }

  const expSlots = slots.filter(
    (s) => s.section === 'experience' && s.kind !== 'title',
  );
  const expIndexes = [
    ...new Set(
      expSlots
        .map((s) => s.experienceIndex)
        .filter((n): n is number => n != null),
    ),
  ];
  if (
    expIndexes.length &&
    careers.length &&
    expIndexes.length !== careers.length
  ) {
    warnings.push(
      `Experience placeholders (${expIndexes.length}) do not match profile careers (${careers.length}).`,
    );
  }

  return { slotCount: slots.length, sectionsFound, slots, warnings };
}

export { fuzzyCompanyMatch };
