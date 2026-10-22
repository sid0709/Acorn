import type { Resume } from '@prisma/client';

export type ResumeSkillEntry = {
  name: string;
  category: string;
  level: number;
};

export type ResumeAnalysisObject = {
  skills: ResumeSkillEntry[];
  provider?: string;
  model?: string;
  usage?: unknown;
};

export type UserResumeSummary = {
  id: string;
  ownerId: string | null;
  ownerName: string;
  techStack: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  extractedText?: string;
  isPrimary: boolean;
  source?: 'uploaded' | 'generated';
  generationId?: string;
  templateId?: string;
  analyzed?: boolean;
  analyzedAt?: string | null;
  skillCount?: number;
  skillProfile?: ResumeSkillEntry[];
  uploadedAt: string;
  updatedAt?: string;
};

export type UserResumeDetail = UserResumeSummary & {
  contentBase64: string | null;
  skillProfile?: ResumeSkillEntry[];
  analysisError?: string | null;
};

function asSkills(analysis: unknown): ResumeSkillEntry[] {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    return [];
  }
  const skills = (analysis as ResumeAnalysisObject).skills;
  return Array.isArray(skills) ? skills : [];
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

export function toResumeSummary(row: Resume): UserResumeSummary {
  const skills = asSkills(row.analysis);
  return {
    id: row.id,
    ownerId: row.profileId || null,
    ownerName: row.ownerName,
    techStack: row.title,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes ?? 0,
    extractedText: row.extractedText ? row.extractedText.slice(0, 500) : '',
    isPrimary: Boolean(row.isPrimary),
    source: row.source === 'generated' ? 'generated' : 'uploaded',
    generationId: row.generationId ?? undefined,
    templateId: row.templateId ?? undefined,
    analyzed: Boolean(row.analyzed),
    analyzedAt: iso(row.analyzedAt),
    skillCount: skills.length,
    skillProfile: skills,
    uploadedAt: iso(row.uploadedAt) || new Date().toISOString(),
    updatedAt: iso(row.updatedAt) || undefined,
  };
}

export function toResumeDetail(
  row: Resume,
  contentBase64: string | null,
): UserResumeDetail {
  const skills = asSkills(row.analysis);
  return {
    ...toResumeSummary(row),
    extractedText: row.extractedText || '',
    contentBase64,
    skillProfile: skills,
    analysisError: row.analysisError ?? null,
  };
}

export function analysisSkills(row: Resume): ResumeSkillEntry[] {
  return asSkills(row.analysis);
}
