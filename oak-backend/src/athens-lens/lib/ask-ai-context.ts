import { FORM_PROFILE_MAX_CHARS, FORM_TREE_MAX_CHARS } from '../ask-ai.prompt';

export type NormalizedPageContext = {
  url: string;
  title: string;
  metaDescription: string;
  visibleText: string;
  formTree: string;
  forms: Array<Record<string, unknown>>;
};

export function normalizePageContext(
  pageContext: Record<string, unknown>,
): NormalizedPageContext {
  const formTree = String(pageContext.formTree || '')
    .trim()
    .slice(0, FORM_TREE_MAX_CHARS);
  const visibleText = String(pageContext.visibleText || '')
    .trim()
    .slice(0, FORM_TREE_MAX_CHARS);
  return {
    url: String(pageContext.url || ''),
    title: String(pageContext.title || ''),
    metaDescription: String(pageContext.metaDescription || ''),
    visibleText,
    formTree,
    forms: Array.isArray(pageContext.forms)
      ? (pageContext.forms as Array<Record<string, unknown>>).slice(0, 120)
      : [],
  };
}

export function buildFormAnswerUserPrompt(
  pageContext: NormalizedPageContext,
  profileJson: string,
  jobTitle?: string,
): string {
  const title = String(jobTitle || '').trim();
  const treeSection = pageContext.formTree
    ? `Fields (answer every number):
${pageContext.formTree}`
    : `Page text:
${pageContext.visibleText || '(none)'}

Form field hints:
${formatFormsText(pageContext.forms)}`;

  return `PROFILE JSON:
${profileJson}

${title ? `Role title (context only): ${title}\n\n` : ''}URL: ${pageContext.url}
Title: ${pageContext.title}

${treeSection}

Reply with N: answer lines only.`;
}

export function sanitizeProfile(
  profile: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const omitRe =
    /(apikey|api_key|apppassword|app_password|password|secret|token|privatekey|private_key)/i;
  for (const [key, value] of Object.entries(profile)) {
    if (omitRe.test(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

export function compactProfileJson(profile: Record<string, unknown>): string {
  const full = JSON.stringify(profile, null, 2);
  if (full.length <= FORM_PROFILE_MAX_CHARS) return full;
  return full.slice(0, FORM_PROFILE_MAX_CHARS);
}

export function mapAskAiUsage(
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null,
  model: string,
): Record<string, unknown> | null {
  if (!usage) return null;
  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    model,
  };
}

function formatFormsText(forms: Array<Record<string, unknown>>): string {
  if (!forms.length) return '(none — discover questions from page text)';
  return forms
    .map((field, index) => {
      const parts = [
        `#${index + 1}`,
        field.label ? `label: ${field.label}` : null,
        field.name ? `name: ${field.name}` : null,
        field.type ? `type: ${field.type}` : null,
        field.placeholder ? `placeholder: ${field.placeholder}` : null,
        field.required ? 'required: yes' : null,
        Array.isArray(field.options)
          ? `options: ${(field.options as string[]).join(', ')}`
          : null,
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .join('\n');
}
