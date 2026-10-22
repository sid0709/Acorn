import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

export const SECTION_SYNONYMS: Record<string, string[]> = {
  summary: [
    'SUMMARY',
    'PROFILE',
    'OBJECTIVE',
    'PROFESSIONAL SUMMARY',
    'EXECUTIVE SUMMARY',
  ],
  experience: [
    'EXPERIENCE',
    'WORK HISTORY',
    'EMPLOYMENT',
    'PROFESSIONAL EXPERIENCE',
    'WORK EXPERIENCE',
    'CAREER HISTORY',
  ],
  skills: [
    'SKILLS',
    'TECHNICAL SKILLS',
    'CORE COMPETENCIES',
    'TECHNOLOGIES',
    'KEY SKILLS',
    'TECHNICAL PROFICIENCIES',
  ],
  education: ['EDUCATION', 'ACADEMIC', 'ACADEMIC BACKGROUND'],
};

export function cleanString(v: unknown): string {
  return String(v ?? '').trim();
}

export function stripNamespaces(xml: string): string {
  return xml
    .replace(/\sxmlns(?::\w+)?="[^"]*"/g, '')
    .replace(/(<\/?)(?:w\d*:|w14:)/g, '$1');
}

export function normalizeHeading(text: string): string {
  return cleanString(text)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyHeading(text: string): string | null {
  const norm = normalizeHeading(text);
  if (!norm) return null;
  for (const [section, synonyms] of Object.entries(SECTION_SYNONYMS)) {
    for (const syn of synonyms) {
      if (
        norm === syn ||
        norm.startsWith(`${syn} `) ||
        norm.endsWith(` ${syn}`)
      ) {
        return section;
      }
    }
  }
  return null;
}

export function normalizeCompany(name: unknown): string {
  return cleanString(name)
    .toLowerCase()
    .replace(/[,.']/g, '')
    .replace(/\b(inc|llc|corp|corporation|ltd|co|company)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fuzzyCompanyMatch(a: unknown, b: unknown): boolean {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

export function paraText($: CheerioAPI, el: Element): string {
  const texts: string[] = [];
  $(el)
    .find('t')
    .each((_, t) => {
      texts.push($(t).text());
    });
  return texts.join('');
}

export function hasBullet($: CheerioAPI, el: Element): boolean {
  return $(el).find('numPr').length > 0;
}

function runStyleAll(
  $: CheerioAPI,
  el: Element,
  tag: 'i' | 'b',
  mode: 'all' | 'any',
): boolean {
  const runs = $(el).find('r');
  if (!runs.length) return false;
  let hasText = false;
  let match = mode === 'all';
  runs.each((_, r) => {
    const t = $(r).find('t').text();
    if (!t.trim()) return;
    hasText = true;
    const has = $(r).find(tag).length > 0;
    if (mode === 'all' && !has) match = false;
    if (mode === 'any' && has) match = true;
  });
  return hasText && match;
}

export function isItalicPara($: CheerioAPI, el: Element): boolean {
  return runStyleAll($, el, 'i', 'all');
}

export function isBoldPara($: CheerioAPI, el: Element): boolean {
  return runStyleAll($, el, 'b', 'any');
}

export function looksLikeTitleDateLine(text: string): boolean {
  const t = cleanString(text);
  if (!t) return false;
  return (
    /\d{4}/.test(t) &&
    (t.includes('–') || t.includes('-') || /present/i.test(t))
  );
}
