import type { GeneratorConfig } from './default-generator-config';
import { stepsToPlan } from './default-generator-config';
import type { GeneratorIdentity } from './identity-from-profile';

export type StoredGeneratorConfig = GeneratorConfig & {
  uploadedTemplate?: Record<string, unknown>;
};

export type PersistedGenerationRequest = {
  applierName: string;
  profileId: string | null;
  provider: string;
  model: string;
  reasoningEffort: string;
  dynamicCareerTitles: boolean;
  templateId: string;
  template: Record<string, unknown> | null;
  theme: GeneratorConfig['theme'];
  layout: Array<{
    type: string;
    title: string;
    titleColor: string;
    titleSize: number;
    bodySize: number;
  }>;
  identity: GeneratorIdentity;
  identitySyncedAt: string;
  systemInstruction: string;
  jobDescription: string;
  jobSkills: string[] | null;
  generateParentJobId: string | null;
  steps: ReturnType<typeof stepsToPlan>;
  coverage: null;
};

/** Build the stored generation request from ResumeConfig + Profile + JD. */
export function persistedGenerationRequest(input: {
  applierName: string;
  profileId: string | null;
  config: StoredGeneratorConfig;
  identity: GeneratorIdentity;
  jobDescription: string;
  jobSkills?: string[] | null;
  parentJobId?: string | null;
}): PersistedGenerationRequest {
  const uploaded =
    input.config.uploadedTemplate &&
    typeof input.config.uploadedTemplate === 'object'
      ? input.config.uploadedTemplate
      : null;
  return {
    applierName: input.applierName,
    profileId: input.profileId,
    provider: input.config.provider,
    model: input.config.model,
    reasoningEffort: input.config.reasoningEffort,
    dynamicCareerTitles: input.config.dynamicCareerTitles === true,
    templateId: input.config.templateId,
    template: uploaded || { id: input.config.templateId },
    theme: input.config.theme,
    layout: input.config.layout.map((section) => ({
      type: section.type,
      title: section.title,
      titleColor: section.titleColor,
      titleSize: section.titleSize,
      bodySize: section.bodySize,
    })),
    identity: input.identity,
    identitySyncedAt: new Date().toISOString(),
    systemInstruction: input.config.systemInstruction,
    jobDescription: input.jobDescription,
    jobSkills: input.jobSkills?.length ? input.jobSkills : null,
    generateParentJobId: input.parentJobId || null,
    steps: stepsToPlan(input.config.steps),
    coverage: null,
  };
}
