export type ResumeLibrarySource = "uploaded" | "generated";

export type ResumeLibraryRow = {
  id: string;
  source: ResumeLibrarySource;
  fileName: string;
  title: string;
  size: number;
  isPrimary: boolean;
  analyzed: boolean;
  analyzedAt: string | null;
  generationId: string | null;
  templateId: string | null;
  uploadedAt: string;
  extractedText?: string;
};

export const RESUME_LIBRARY_ACCEPT = ".pdf,.doc,.docx,.txt";
export const RESUME_LIBRARY_MAX_BYTES = 8 * 1024 * 1024;
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
