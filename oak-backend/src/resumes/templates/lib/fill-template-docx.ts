import PizZip from 'pizzip';
import { fuzzyCompanyMatch } from './parse-template-docx';
import {
  cloneParaWithRichText,
  replacePlaceholderWithRichText,
} from './ooxml-rich-text';
import type { ResumeTemplateSlot } from '../mappers/resume-template.mapper';

const PARA_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const BODY_RE = /<w:body\b([^>]*)>([\s\S]*?)<\/w:body>/;

type SkillGroup = { category: string; items: string[] };
type ExperienceRow = { company: string; title: string; bullets: string[] };
type Normalized = {
  headline: string;
  summary: string;
  skills: SkillGroup[];
  experiences: ExperienceRow[];
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function normalizeSections(
  sections: Record<string, unknown> | undefined,
): Normalized {
  const root = obj(sections);
  const summarySec = obj(sections?.summary);
  const skillsSec = obj(sections?.skills);
  const expSec = obj(sections?.experience);
  const skillsArr = Array.isArray(skillsSec.skills) ? skillsSec.skills : [];
  const expArr = Array.isArray(expSec.experiences)
    ? expSec.experiences
    : Array.isArray(expSec.experience)
      ? expSec.experience
      : [];
  const experiences: ExperienceRow[] = expArr.map((e) => {
    const row = obj(e);
    return {
      company: String(row.company ?? ''),
      title: String(row.title ?? row.role ?? ''),
      bullets: Array.isArray(row.bullets)
        ? row.bullets.map(String).filter(Boolean)
        : [],
    };
  });
  const headline =
    (typeof root.headline === 'string' && root.headline) ||
    experiences[0]?.title ||
    '';
  return {
    headline,
    summary: typeof summarySec.summary === 'string' ? summarySec.summary : '',
    skills: skillsArr
      .map((g) => {
        const row = obj(g);
        const items = Array.isArray(row.items) ? row.items.map(String) : [];
        return { category: String(row.category ?? ''), items };
      })
      .filter((g) => g.category || g.items.length),
    experiences,
  };
}

function formatSkills(skills: SkillGroup[]): string {
  return skills
    .map((g) => {
      const items = g.items.join(', ');
      return g.category ? `${g.category}: ${items}` : items;
    })
    .join('; ');
}

function resolveExperience(
  slot: ResumeTemplateSlot,
  experiences: ExperienceRow[],
  used: Set<number>,
): ExperienceRow | null {
  if (slot.experienceIndex != null && experiences[slot.experienceIndex]) {
    used.add(slot.experienceIndex);
    return experiences[slot.experienceIndex];
  }
  if (slot.companyHint) {
    const idx = experiences.findIndex(
      (e, i) => !used.has(i) && fuzzyCompanyMatch(e.company, slot.companyHint),
    );
    if (idx >= 0) {
      used.add(idx);
      return experiences[idx];
    }
  }
  const next = experiences.findIndex((_, i) => !used.has(i));
  if (next >= 0) {
    used.add(next);
    return experiences[next];
  }
  return null;
}

function extractParagraphs(xml: string): string[] {
  return [...xml.matchAll(PARA_RE)].map((m) => m[0]);
}

function rebuildBodyFromParagraphs(xml: string, paragraphs: string[]): string {
  const match = xml.match(BODY_RE);
  if (!match) return xml;
  const sectPr = match[2].match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] ?? '';
  return xml.replace(
    BODY_RE,
    `<w:body${match[1]}>${paragraphs.join('')}${sectPr}</w:body>`,
  );
}

function applyToken(
  paraXml: string,
  placeholder: string,
  text: string,
): string {
  const next = replacePlaceholderWithRichText(paraXml, text, placeholder);
  return next;
}

function namedValue(
  slot: ResumeTemplateSlot,
  normalized: Normalized,
  skillIndex: number,
): string {
  const kind = slot.kind || '';
  if (kind === 'headline') return normalized.headline;
  if (kind === 'summary' || slot.token === 'summary') return normalized.summary;
  const exp =
    slot.experienceIndex != null
      ? normalized.experiences[slot.experienceIndex]
      : undefined;
  if (kind === 'title') return exp?.title || '';
  if (kind === 'bullets') return exp?.bullets?.[0] || '';
  const group = normalized.skills[skillIndex];
  if (kind === 'category') return group?.category || '';
  if (kind === 'items') return group?.items.join(', ') || '';
  return '';
}

export function fillTemplateDocx(
  buffer: Buffer,
  manifest: { slots?: ResumeTemplateSlot[]; warnings?: string[] },
  sections: Record<string, unknown> | undefined,
): { buffer: Buffer; warnings: string[] } {
  const zip = new PizZip(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Invalid DOCX: missing word/document.xml');

  const originalXml = docFile.asText();
  const paragraphs = extractParagraphs(originalXml);
  const normalized = normalizeSections(sections);
  const warnings = [...(manifest.warnings || [])];
  const usedExperiences = new Set<number>();
  const slots = Array.isArray(manifest.slots) ? [...manifest.slots] : [];
  const byPara = new Map<number, ResumeTemplateSlot[]>();
  for (const slot of slots) {
    const list = byPara.get(slot.paragraphIndex) || [];
    list.push(slot);
    byPara.set(slot.paragraphIndex, list);
  }
  const paraIndexes = [...byPara.keys()].sort((a, b) => b - a);

  for (const idx of paraIndexes) {
    const paraSlots = byPara.get(idx) || [];
    const original = paragraphs[idx];
    if (!original) {
      warnings.push(`Paragraph ${idx} not found.`);
      continue;
    }
    const named = paraSlots.filter((s) => s.kind && s.kind !== 'anonymous');
    if (named.length) {
      let xml = original;
      for (const slot of named) {
        const placeholder = slot.token ? `{${slot.token}}` : '{}';
        const value = namedValue(slot, normalized, 0);
        if (!value) {
          warnings.push(`Slot {${slot.token || ''}} unfilled.`);
        }
        xml = applyToken(xml, placeholder, value);
      }
      paragraphs[idx] = xml;
      const bulletSlot = named.find((s) => s.kind === 'bullets' && s.isBullet);
      if (bulletSlot?.experienceIndex != null) {
        const bullets =
          normalized.experiences[bulletSlot.experienceIndex]?.bullets || [];
        const placeholder = `{${bulletSlot.token}}`;
        if (bullets.length > 1) {
          const inserts = bullets
            .slice(1)
            .map((b) => cloneParaWithRichText(original, b, placeholder));
          paragraphs.splice(idx + 1, 0, ...inserts);
        }
      }
      const skillSlots = named.filter(
        (s) => s.kind === 'category' || s.kind === 'items',
      );
      if (skillSlots.length && normalized.skills.length > 1) {
        const inserts = normalized.skills.slice(1).map((group) => {
          let clone = original;
          for (const slot of skillSlots) {
            const placeholder = slot.token ? `{${slot.token}}` : '{}';
            const value =
              slot.kind === 'category'
                ? group.category
                : group.items.join(', ');
            clone = applyToken(clone, placeholder, value);
          }
          return clone;
        });
        paragraphs.splice(idx + 1, 0, ...inserts);
      }
      continue;
    }

    const slot = paraSlots[0];
    if (!slot) continue;
    if (slot.section === 'summary') {
      paragraphs[idx] = applyToken(original, '{}', normalized.summary || '');
      continue;
    }
    if (slot.section === 'skills') {
      paragraphs[idx] = applyToken(
        original,
        '{}',
        formatSkills(normalized.skills),
      );
      continue;
    }
    if (slot.section !== 'experience') continue;
    const exp = resolveExperience(
      slot,
      normalized.experiences,
      usedExperiences,
    );
    if (!exp) {
      warnings.push(`Experience slot ${slot.index}: no matching AI content.`);
      continue;
    }
    const bullets = exp.bullets.length ? exp.bullets : [''];
    paragraphs[idx] = applyToken(original, '{}', bullets[0]);
    if (bullets.length > 1 && slot.isBullet) {
      const inserts = bullets
        .slice(1)
        .map((b) => cloneParaWithRichText(original, b, '{}'));
      paragraphs.splice(idx + 1, 0, ...inserts);
    }
  }

  zip.file(
    'word/document.xml',
    rebuildBodyFromParagraphs(originalXml, paragraphs),
  );
  return { buffer: zip.generate({ type: 'nodebuffer' }) as Buffer, warnings };
}
