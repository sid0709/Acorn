export type FormAnswer = {
  question: string;
  suggestedAnswer: string;
  confidence: string;
};

/** Parse "1. kind | Label | name=…" lines from the Oak field list. */
export function fieldLabelsFromFormTree(formTree: string): Map<number, string> {
  const labels = new Map<number, string>();
  for (const raw of String(formTree || '').split('\n')) {
    const match = raw.match(/^\s*(\d+)\.\s+\S+\s+\|\s+([^|]+?)(?:\s+\||\s*$)/);
    if (!match) continue;
    const index = Number(match[1]);
    const label = String(match[2] || '').trim();
    if (!Number.isFinite(index) || index < 1 || !label) continue;
    labels.set(index, label);
  }
  return labels;
}

/**
 * Best-effort parse of streaming / partial answers.
 * Prefers compact `N: answer` lines; falls back to legacy JSON pairs.
 */
export function extractFormAnswersFromPartialText(
  text: string,
  formTree = '',
): FormAnswer[] {
  const source = String(text || '');
  const byKey = new Map<string, FormAnswer>();
  const labels = fieldLabelsFromFormTree(formTree);

  const push = (
    question: string,
    suggestedAnswer: string,
    confidence = 'medium',
  ) => {
    const q = String(question || '').trim();
    const a = String(suggestedAnswer || '').trim();
    if (!q || !a) return;
    byKey.set(q.toLowerCase(), {
      question: q,
      suggestedAnswer: a,
      confidence: ['high', 'medium', 'low'].includes(confidence)
        ? confidence
        : 'medium',
    });
  };

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (
      !line ||
      line.startsWith('#') ||
      line.startsWith('{') ||
      line.startsWith('[')
    ) {
      continue;
    }
    const numbered = line.match(/^(\d+)\s*[:.)\-]\s*(.+)$/);
    if (!numbered) continue;
    const index = Number(numbered[1]);
    const answer = String(numbered[2] || '').trim();
    if (!Number.isFinite(index) || index < 1 || !answer) continue;
    const question = labels.get(index) || `Field ${index}`;
    push(question, answer);
  }

  const unescapeJson = (value: string) => {
    try {
      return JSON.parse(`"${value}"`) as string;
    } catch {
      return value.replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }
  };
  const pairRe =
    /"question"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"suggestedAnswer"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  const pairReAlt =
    /"suggestedAnswer"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"question"\s*:\s*"((?:\\.|[^"\\])*)"/g;

  for (const match of source.matchAll(pairRe)) {
    push(unescapeJson(match[1] || ''), unescapeJson(match[2] || ''));
  }
  for (const match of source.matchAll(pairReAlt)) {
    push(unescapeJson(match[2] || ''), unescapeJson(match[1] || ''));
  }

  try {
    const parsed = JSON.parse(source) as {
      formAnswers?: Array<{
        question?: string;
        suggestedAnswer?: string;
        confidence?: string;
      }>;
    };
    for (const entry of parsed?.formAnswers || []) {
      push(
        String(entry.question || ''),
        String(entry.suggestedAnswer || ''),
        String(entry.confidence || 'medium'),
      );
    }
  } catch {
    // Partial stream — ignore.
  }

  return [...byKey.values()];
}
