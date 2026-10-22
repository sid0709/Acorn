import { JOB_TITLE_REVIEW_LABELS } from '../constants/job-pipeline.constants';

const LABEL_SET = new Set<string>([
  JOB_TITLE_REVIEW_LABELS.APPROVED,
  JOB_TITLE_REVIEW_LABELS.REVIEW_REQUIRED,
]);

export type TitleReviewExpectedItem = {
  index: number;
  title: string;
};

export type TitleReviewParsedRow = {
  index: number;
  title: string;
  label: 'APPROVED' | 'REVIEW_REQUIRED';
  confidence: number;
  reason: string;
};

export type TitleReviewParseError = {
  code: string;
  message: string;
};

/** Strictly validate model JSON against submitted indexes and titles. */
export function parseTitleReviewJson(
  content: string,
  expectedItems: TitleReviewExpectedItem[],
): {
  valid: Map<number, TitleReviewParsedRow>;
  errors: Map<number, TitleReviewParseError>;
} {
  const valid = new Map<number, TitleReviewParsedRow>();
  const errors = new Map<number, TitleReviewParseError>();
  const expected = new Map(
    expectedItems.map((item) => [Number(item.index), item]),
  );

  for (const item of expectedItems) {
    errors.set(Number(item.index), {
      code: 'MISSING_RESULT',
      message: 'The model omitted this title.',
    });
  }

  let data: { results?: unknown };
  try {
    data = JSON.parse(String(content || '')) as { results?: unknown };
  } catch {
    for (const item of expectedItems) {
      errors.set(Number(item.index), {
        code: 'INVALID_JSON',
        message: 'The model returned invalid JSON.',
      });
    }
    return { valid, errors };
  }

  if (!data || !Array.isArray(data.results)) {
    for (const item of expectedItems) {
      errors.set(Number(item.index), {
        code: 'INVALID_SHAPE',
        message: 'The model response has no results array.',
      });
    }
    return { valid, errors };
  }

  const rowsByIndex = new Map<number, unknown[]>();
  for (const row of data.results) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const index = (row as { index?: unknown }).index;
    if (!Number.isInteger(index) || !expected.has(index as number)) continue;
    const rows = rowsByIndex.get(index as number) || [];
    rows.push(row);
    rowsByIndex.set(index as number, rows);
  }

  for (const [index, item] of expected) {
    const rows = rowsByIndex.get(index) || [];
    if (rows.length === 0) continue;
    if (rows.length > 1) {
      errors.set(index, {
        code: 'DUPLICATE_INDEX',
        message: `The model returned index ${index} more than once.`,
      });
      continue;
    }
    const row = rows[0] as {
      title?: unknown;
      label?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    if (typeof row.title !== 'string' || row.title !== item.title) {
      errors.set(index, {
        code: 'TITLE_MISMATCH',
        message:
          'The returned title did not exactly match the submitted title.',
      });
      continue;
    }
    if (typeof row.label !== 'string' || !LABEL_SET.has(row.label)) {
      errors.set(index, {
        code: 'INVALID_LABEL',
        message: 'The model returned an unsupported label.',
      });
      continue;
    }
    if (
      typeof row.confidence !== 'number' ||
      !Number.isFinite(row.confidence) ||
      row.confidence < 0 ||
      row.confidence > 1
    ) {
      errors.set(index, {
        code: 'INVALID_CONFIDENCE',
        message: 'The model returned an invalid confidence value.',
      });
      continue;
    }
    const reason = typeof row.reason === 'string' ? row.reason.trim() : '';
    if (!reason) {
      errors.set(index, {
        code: 'INVALID_REASON',
        message: 'The model returned an empty reason.',
      });
      continue;
    }
    valid.set(index, {
      index,
      title: row.title,
      label: row.label as 'APPROVED' | 'REVIEW_REQUIRED',
      confidence: row.confidence,
      reason: reason.slice(0, 500),
    });
    errors.delete(index);
  }

  return { valid, errors };
}
