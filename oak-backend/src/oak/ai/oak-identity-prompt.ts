export const IDENTITY_KIND_APPLICATION_AI = 'application_ai';
export const IDENTITY_KIND_WORKPLACE_AI = 'workplace_ai';
export const IDENTITY_KIND_OTHER = 'other';

export const IDENTITY_SYSTEM_PROMPT = `You classify job-application questions by meaning, not by a word list.

Each item has element_index, role, and question. Return one kind per item:

- application_ai: the question asks whether the applicant used an automated assistant to write, fill, or submit THIS application; whether the applicant is a bot / automated agent; or whether they consent to automated hiring, screening, or employment-decision tools assessing them.
- workplace_ai: the question asks about professional use of assistants or language models in the applicant's own work — which tools, how often, or examples of impact on output.
- other: everything else, including SMS/email/phone communication consent.

Decide from what the question is asking. Do not use a closed list of product names.

Return only valid json:
{"classifications":[{"element_index":31,"kind":"workplace_ai"}]}

Classify every listed element_index. No markdown.`;

export function buildIdentityUserPrompt(
  fields: Array<{ elementIndex: number; role: string; question: string }>,
): string {
  const lines = fields.map((field) =>
    [
      `element_index: ${field.elementIndex}`,
      `role: ${field.role || '(none)'}`,
      `question: ${field.question}`,
    ].join('\n'),
  );
  return `Questions:
${lines.join('\n\n')}

Return json with one classifications[].kind per element_index.`.trim();
}
