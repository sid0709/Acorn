export type ResumeTemplateSection =
  'summary' | 'skills' | 'experience' | string;

export type ResumeTemplateSlot = {
  index: number;
  paragraphIndex: number;
  section: ResumeTemplateSection;
  isBullet: boolean;
  companyHint?: string;
  experienceIndex?: number;
  token?: string;
  kind?: string;
};

export type TemplateIdentity = {
  careers?: Array<{ company?: string }>;
};

export type ResumeTemplateManifest = {
  id: string;
  name: string;
  source: 'uploaded';
  format: 'docx';
  fileName: string;
  slotCount: number;
  sectionsFound: string[];
  slots: ResumeTemplateSlot[];
  warnings: string[];
  uploadedAt?: string;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function asSlots(value: unknown): ResumeTemplateSlot[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const row =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const hint =
      typeof row.companyHint === 'string' ? row.companyHint : undefined;
    const exp =
      typeof row.experienceIndex === 'number' ? row.experienceIndex : undefined;
    const token = typeof row.token === 'string' ? row.token : undefined;
    const kind = typeof row.kind === 'string' ? row.kind : undefined;
    return {
      index: typeof row.index === 'number' ? row.index : index,
      paragraphIndex:
        typeof row.paragraphIndex === 'number' ? row.paragraphIndex : index,
      section: String(row.section || 'summary'),
      isBullet: Boolean(row.isBullet),
      ...(hint ? { companyHint: hint } : {}),
      ...(exp != null ? { experienceIndex: exp } : {}),
      ...(token ? { token } : {}),
      ...(kind ? { kind } : {}),
    };
  });
}

function iso(d: Date | string | null | undefined): string | undefined {
  if (!d) return undefined;
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

export function toTemplateManifest(row: {
  id: string;
  name: string;
  fileName: string;
  slotCount: number;
  sectionsFound: unknown;
  slots: unknown;
  warnings: unknown;
  uploadedAt?: Date | string | null;
}): ResumeTemplateManifest {
  return {
    id: row.id,
    name: row.name,
    source: 'uploaded',
    format: 'docx',
    fileName: row.fileName,
    slotCount: row.slotCount ?? 0,
    sectionsFound: asStringArray(row.sectionsFound),
    slots: asSlots(row.slots),
    warnings: asStringArray(row.warnings),
    uploadedAt: iso(row.uploadedAt),
  };
}

export function templateDocumentId(templateId: string): string {
  return String(templateId ?? '')
    .replace(/^upload:/, '')
    .trim();
}
