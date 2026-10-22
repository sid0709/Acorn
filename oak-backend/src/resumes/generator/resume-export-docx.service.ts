import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from 'docx';
import { cleanString } from './lib/clean-string';
import { formatResumePeriodLabel } from './lib/format-resume-date';

const TWIPS_PER_IN = 1440;
const PAGE_IN = {
  letter: { w: 8.5, h: 11 },
  a4: { w: 8.27, h: 11.69 },
} as const;

/**
 * Structured-model → DOCX (Editor Word export).
 */
@Injectable()
export class ResumeExportDocxService {
  async render(input: {
    model: Record<string, unknown>;
    paper?: string;
    marginInches?: number;
    font?: string;
  }): Promise<Buffer> {
    const model = input.model;
    if (!model || typeof model !== 'object') {
      throw new BadRequestException({
        success: false,
        error: 'model is required',
      });
    }

    const paper = input.paper === 'a4' ? 'a4' : 'letter';
    const marginRaw = Number(input.marginInches);
    const marginIn =
      Number.isFinite(marginRaw) && marginRaw >= 0 ? marginRaw : 0.6;
    const marginTwips = Math.round(marginIn * TWIPS_PER_IN);
    const font =
      (input.font
        ? String(input.font).split(',')[0].replace(/['"]/g, '').trim()
        : '') || 'Calibri';

    const baseSize = pt(model.baseSizePt, 21);
    const textColor = hex(model.textColor) || '1a1a1a';
    const accent = hex(model.accentColor) || '1f3a5f';
    const headerAlign =
      model.headerAlign === 'left' ? AlignmentType.LEFT : AlignmentType.CENTER;
    const rightTab = Math.round(
      (PAGE_IN[paper].w - marginIn * 2) * TWIPS_PER_IN,
    );
    const baseRun = { font, size: baseSize, color: textColor };
    const children: Paragraph[] = [];

    children.push(
      new Paragraph({
        alignment: headerAlign,
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: cleanString(model.name) || 'Your Name',
            bold: true,
            font,
            size: pt(model.nameSizePt, 48),
            color: hex(model.nameColor) || textColor,
          }),
        ],
      }),
    );

    if (Array.isArray(model.contact) && model.contact.length) {
      children.push(
        new Paragraph({
          alignment: headerAlign,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: model.contact
                .map((c) => cleanString(c))
                .filter(Boolean)
                .join('    ·    '),
              font,
              size: Math.max(16, baseSize - 3),
              color: textColor,
            }),
          ],
        }),
      );
    }

    const headingAlign =
      model.headingAlign === 'center'
        ? AlignmentType.CENTER
        : AlignmentType.LEFT;

    for (const section of Array.isArray(model.sections) ? model.sections : []) {
      const sec = section as Record<string, unknown>;
      const headingColor = hex(sec.headingColor) || accent;
      const titleSize = pt(sec.titleSizePt, 24);
      const bodySize = pt(sec.bodySizePt, baseSize);
      const title = cleanString(sec.title).toUpperCase();
      const bodyRun = { font, size: bodySize, color: textColor };

      children.push(
        new Paragraph({
          alignment: headingAlign,
          spacing: { before: 160, after: 80 },
          border:
            sec.headingStyle === 'underline'
              ? {
                  bottom: {
                    style: BorderStyle.SINGLE,
                    size: 6,
                    color: headingColor,
                    space: 2,
                  },
                }
              : undefined,
          children: [
            new TextRun({
              text: title,
              bold: true,
              font,
              size: titleSize,
              color: headingColor,
              characterSpacing: 14,
            }),
          ],
        }),
      );

      appendSectionBody(children, sec, bodyRun, headingColor, rightTab);
    }

    const doc = new Document({
      styles: { default: { document: { run: { font, size: baseSize } } } },
      sections: [
        {
          properties: {
            page: {
              size: {
                width: Math.round(PAGE_IN[paper].w * TWIPS_PER_IN),
                height: Math.round(PAGE_IN[paper].h * TWIPS_PER_IN),
              },
              margin: {
                top: marginTwips,
                bottom: marginTwips,
                left: marginTwips,
                right: marginTwips,
              },
            },
          },
          children,
        },
      ],
    });

    return Buffer.from(await Packer.toBuffer(doc));
  }
}

function appendSectionBody(
  children: Paragraph[],
  section: Record<string, unknown>,
  bodyRun: { font: string; size: number; color: string },
  headingColor: string,
  rightTab: number,
) {
  if (section.type === 'summary') {
    children.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 120 },
        children: richRuns(section.summary, bodyRun),
      }),
    );
    return;
  }
  if (section.type === 'skills') {
    for (const g of Array.isArray(section.skills) ? section.skills : []) {
      const group = g as { category?: unknown; items?: unknown[] };
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              ...bodyRun,
              text: `${cleanString(group.category)}: `,
              bold: true,
              color: headingColor,
            }),
            new TextRun({
              ...bodyRun,
              text: (Array.isArray(group.items) ? group.items : [])
                .map((item) => cleanString(item))
                .filter(Boolean)
                .join(', '),
            }),
          ],
        }),
      );
    }
    return;
  }
  if (section.type === 'experience') {
    for (const e of Array.isArray(section.experience)
      ? section.experience
      : []) {
      const exp = e as Record<string, unknown>;
      children.push(
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: rightTab }],
          spacing: { before: 120 },
          children: [
            new TextRun({
              ...bodyRun,
              text: cleanString(exp.title),
              bold: true,
            }),
            new TextRun({
              ...bodyRun,
              children: [
                new Tab(),
                formatResumePeriodLabel(cleanString(exp.period)),
              ],
              color: '6b7280',
            }),
          ],
        }),
      );
      const company = cleanString(exp.company);
      if (company) {
        children.push(
          new Paragraph({
            spacing: { after: 20 },
            children: [
              new TextRun({
                ...bodyRun,
                text: company,
                italics: true,
                color: headingColor,
              }),
            ],
          }),
        );
      }
      for (const b of Array.isArray(exp.bullets) ? exp.bullets : []) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 10 },
            children: richRuns(b, bodyRun),
          }),
        );
      }
    }
    return;
  }
  if (section.type === 'education') {
    for (const ed of Array.isArray(section.education)
      ? section.education
      : []) {
      const row = ed as Record<string, unknown>;
      children.push(
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: rightTab }],
          spacing: { before: 60 },
          children: [
            new TextRun({
              ...bodyRun,
              text: cleanString(row.school),
              bold: true,
            }),
            new TextRun({
              ...bodyRun,
              children: [
                new Tab(),
                formatResumePeriodLabel(cleanString(row.period)),
              ],
              color: '6b7280',
            }),
          ],
        }),
      );
      const degree = cleanString(row.degree);
      if (degree) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                ...bodyRun,
                text: degree,
                italics: true,
                color: headingColor,
              }),
            ],
          }),
        );
      }
    }
  }
}

function pt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 2) : fallback;
}

function hex(value: unknown): string | undefined {
  const s = cleanString(value).replace(/^#/, '');
  return s || undefined;
}

function richRuns(
  text: unknown,
  base: { font: string; size: number; color: string; bold?: boolean },
): TextRun[] {
  const out: TextRun[] = [];
  const parts = cleanString(text).split(/(\*\*[^*]+?\*\*)/g);
  for (const p of parts) {
    if (!p) continue;
    const bold = /^\*\*[^*]+?\*\*$/.test(p);
    out.push(
      new TextRun({
        ...base,
        text: bold ? p.slice(2, -2) : p,
        bold: bold || Boolean(base.bold),
      }),
    );
  }
  return out.length ? out : [new TextRun({ ...base, text: '' })];
}
