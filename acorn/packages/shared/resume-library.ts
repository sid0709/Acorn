import { coerceString } from "./coerce-string";

export type ResumeLibrarySource = "uploaded" | "generated";

/** Radar categories from résumé skill analysis. */
export const RESUME_SKILL_CATEGORIES = ["hard", "devops", "tools", "domain", "soft"] as const;

export type ResumeSkillCategory = (typeof RESUME_SKILL_CATEGORIES)[number];

export type ResumeSkillEntry = {
  name: string;
  category: string;
  level: number;
};

export type ResumeLibraryRow = {
  id: string;
  source: ResumeLibrarySource;
  fileName: string;
  title: string;
  size: number;
  isPrimary: boolean;
  analyzed: boolean;
  analyzedAt: string | null;
  skillCount: number;
  skillProfile: ResumeSkillEntry[];
  generationId: string | null;
  templateId: string | null;
  uploadedAt: string;
  extractedText?: string;
};

export const RESUME_LIBRARY_ACCEPT = ".pdf,.doc,.docx,.txt";
export const RESUME_LIBRARY_MAX_BYTES = 8 * 1024 * 1024;
/** Parallel library uploads. Matches the Athens library folder upload. */
export const RESUME_BULK_UPLOAD_CONCURRENCY = 8;
/** How many résumés one folder upload may include. */
export const RESUME_BULK_UPLOAD_MAX_FILES = 300;
/** Parallel skill-analysis calls from the library. */
export const RESUME_ANALYZE_CONCURRENCY = 4;
export const RESUME_TEMPLATE_ACCEPT = ".docx";
export const RESUME_TEMPLATE_MAX_BYTES = 8 * 1024 * 1024;

export type ResumeRecommendResult = {
  recommendedResumeId: string;
  recommendedResumeStack: string;
  recommendedResumeReason: string | null;
  warning: string | null;
};

export type ResumeFilePayload = {
  key: string;
  name: string;
  mimeType: string;
  base64: string;
  label?: string | null;
  resumeId?: string | null;
  jobId?: string | null;
};

export type ResumePreviewPayload = {
  success: true;
  html: string;
};

/** One Library résumé Recommend ranked, with the SelectorGateway's probability it fits. */
export type RecommendedResumeRank = {
  resumeId: string;
  stack: string;
  probability: number;
};

/** Top ranks from a Recommend response; anything malformed is dropped. */
export function readRecommendedTop(raw: unknown): RecommendedResumeRank[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const item = (row ?? {}) as Record<string, unknown>;
      const resumeId = coerceString(item.resumeId ?? "").trim();
      const stack = coerceString(item.stack ?? "").trim();
      const probability = Number(item.probability);
      return { resumeId, stack, probability: Number.isFinite(probability) ? probability : 0 };
    })
    .filter((row) => row.resumeId && row.stack);
}
