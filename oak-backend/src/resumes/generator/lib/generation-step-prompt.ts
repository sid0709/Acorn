import { applyPromptTokens } from './apply-prompt-tokens';
import { appendExperienceTitlePolicy, sourceCareers } from './title-policy';

/** Resolve one generation step’s user prompt (tokens + experience title policy). */
export function buildStepUserContent(input: {
  promptTemplate: string;
  tokenMap: Record<string, string>;
  isFinal: boolean;
  purpose: unknown;
  schema: unknown;
  dynamicTitles: boolean;
  jobDescription?: string;
  careers: ReturnType<typeof sourceCareers>;
}): string {
  let userContent = applyPromptTokens(input.promptTemplate, input.tokenMap);
  if (input.isFinal && input.schema) {
    userContent += `\n\nReturn ONLY a JSON object that conforms to this JSON Schema:\n${
      typeof input.schema === 'string'
        ? input.schema
        : JSON.stringify(input.schema)
    }`;
  }
  if (input.isFinal && input.purpose === 'experience') {
    userContent = appendExperienceTitlePolicy(userContent, {
      dynamicCareerTitles: input.dynamicTitles,
      jobDescription: input.jobDescription,
      careers: input.careers,
    });
  }
  return userContent;
}
