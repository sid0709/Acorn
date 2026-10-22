/** Compact `N: answer` lines — matches athens-lens progressive parse. */
export const ASK_AI_SYSTEM_PROMPT = `Fill application form fields from PROFILE JSON.

Output plain text only. One line per field, in field order:
N: answer

Example:
1: attached
2: Jane Doe
3: jane@example.com

Rules:
- N is the field number from the list. answer is the exact text to type or select.
- Prefer exact PROFILE values. For Yes/No or listed options, use an option exactly.
- Never invent employers, dates, degrees, or credentials absent from PROFILE.
- If unknown, a short honest answer. Never leave an answer blank.
- No JSON, no markdown, no commentary, no confidence, no summary.`;

export const FORM_TREE_MAX_CHARS = 12_000;
export const FORM_PROFILE_MAX_CHARS = 4_000;
