import type { GenerateEnqueueCheckpoint } from "./generate-checkpoint";
import type { ResumeGeneratorConfig } from "./resume-config";
import type { ResumeIdentity } from "./resume-content";
import type { ResumeHistoryQuery } from "./resume-history";

/** Website editor, library, and history. Extension custom/job routes stay as they are. */
export const RESUME_API = {
  config: "/acorn/resume/config",
  templates: "/acorn/resume/templates",
  template: (id: string) => `/acorn/resume/templates/${encodeURIComponent(id)}`,
  templatePreview: "/acorn/resume/templates/preview",
  preview: "/acorn/resume/preview",
  generate: "/acorn/resume/generate",
  generateContinue: (inputId: string) =>
    `/acorn/resume/generate/${encodeURIComponent(inputId)}/continue`,
  generatePoll: (inputId: string) => `/acorn/resume/generate/${encodeURIComponent(inputId)}`,
  generations: "/acorn/resume/generations",
  generation: (id: string) => `/acorn/resume/generations/${encodeURIComponent(id)}`,
  generationDocx: (id: string) => `/acorn/resume/generations/${encodeURIComponent(id)}/docx`,
  generationPreview: (id: string) => `/acorn/resume/generations/${encodeURIComponent(id)}/preview`,
  library: "/acorn/resume/library",
  libraryItem: (id: string) => `/acorn/resume/library/${encodeURIComponent(id)}`,
  libraryAnalyze: (id: string) => `/acorn/resume/library/${encodeURIComponent(id)}/analyze`,
  libraryPrimary: (id: string) => `/acorn/resume/library/${encodeURIComponent(id)}/primary`,
  libraryPreview: (id: string) => `/acorn/resume/library/${encodeURIComponent(id)}/preview`,
  libraryFile: (id: string) => `/acorn/resume/library/${encodeURIComponent(id)}/file`,
} as const;

export const CUSTOM_RESUME_API = {
  extractJd: "/acorn/custom/extract-jd",
  generate: "/acorn/custom/generate",
  generateContinue: (inputId: string) =>
    `/acorn/custom/generate/${encodeURIComponent(inputId)}/continue`,
  generatePoll: (inputId: string) => `/acorn/custom/generate/${encodeURIComponent(inputId)}`,
  recommend: "/acorn/custom/recommend",
  libraryResume: (id: string) => `/acorn/custom/library-resumes/${encodeURIComponent(id)}`,
  libraryPreview: (id: string) => `/acorn/custom/library-resumes/${encodeURIComponent(id)}/preview`,
  generatedResume: (id: string) => `/acorn/custom/resumes/${encodeURIComponent(id)}`,
  generatedPreview: (id: string) => `/acorn/custom/resumes/${encodeURIComponent(id)}/preview`,
  jobGenerate: (jobId: string) => `/acorn/jobs/${encodeURIComponent(jobId)}/generate`,
  jobPreview: (jobId: string) => `/acorn/jobs/${encodeURIComponent(jobId)}/resume-preview`,
  jobRecommended: (jobId: string) => `/acorn/jobs/${encodeURIComponent(jobId)}/recommended-resume`,
} as const;

export type ResumeGenerateRequest = {
  jobDescription: string;
  jobId?: string | null;
  identity?: ResumeIdentity | null;
  checkpoint?: GenerateEnqueueCheckpoint | null;
};

export type ResumeGenerateEnqueue = {
  ok: true;
  inputId: string;
};

export type ResumeGeneratePoll = {
  status: string;
  generationId: string | null;
  resumeId: string | null;
  error: string | null;
  partialSections: Record<string, unknown> | null;
  progress: ResumeGenerateProgress | null;
};

export type ResumeGenerateProgressStep = {
  index: number;
  name: string;
  purpose: string;
  kind: string;
  status: "pending" | "running" | "done";
  output?: unknown;
};

export type ResumeGenerateProgress = {
  steps: ResumeGenerateProgressStep[];
  done: boolean;
  message?: string | null;
};

export type ResumeConfigResponse = {
  success: true;
  config: ResumeGeneratorConfig;
};

export function historyQueryString(query: ResumeHistoryQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.searchIn && query.searchIn !== "all") params.set("searchIn", query.searchIn);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.model) params.set("model", query.model);
  if (query.provider) params.set("provider", query.provider);
  if (query.templateId) params.set("templateId", query.templateId);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.sort && query.sort !== "newest") params.set("sort", query.sort);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  if (query.includeFacets) params.set("includeFacets", "1");
  const text = params.toString();
  return text ? `?${text}` : "";
}
