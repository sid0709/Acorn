import { cleanString } from './clean-string';

type CareerLike = {
  company?: unknown;
  period?: unknown;
};

/** Fold a company or date into a comparable key. */
export function experienceIdentityKey(value: unknown): string {
  return cleanString(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Pair each profile role with the model row that belongs to it.
 * Exact company, then a close spelling or shortened name, then order
 * when the model did not use recognizable company names.
 */
export function matchExperienceRows(
  careers: CareerLike[],
  modelList: Record<string, unknown>[],
): Record<string, unknown>[] {
  const unused = new Set(modelList.map((_, index) => index));
  const recognizable = modelList.some((row) =>
    careers.some((career) =>
      companiesAlign(
        experienceIdentityKey(career?.company),
        experienceIdentityKey(row?.company),
      ),
    ),
  );

  return careers.map((career, careerIndex) => {
    const index = pickRow(
      career,
      careerIndex,
      careers.length,
      modelList,
      unused,
      recognizable,
    );
    if (index == null) return {};
    unused.delete(index);
    const row = modelList[index];
    return row && typeof row === 'object' ? row : {};
  });
}

function pickRow(
  career: CareerLike,
  careerIndex: number,
  careerCount: number,
  modelList: Record<string, unknown>[],
  unused: Set<number>,
  recognizable: boolean,
): number | null {
  const companyKey = experienceIdentityKey(career?.company);
  const periodKey = experienceIdentityKey(career?.period);
  const exact = unusedIndexes(unused, (index) =>
    Boolean(
      companyKey &&
      experienceIdentityKey(modelList[index]?.company) === companyKey,
    ),
  );
  if (exact.length) return preferPeriod(exact, modelList, periodKey);

  const close = unusedIndexes(unused, (index) =>
    companiesAlign(
      companyKey,
      experienceIdentityKey(modelList[index]?.company),
    ),
  );
  if (close.length) return preferPeriod(close, modelList, periodKey);

  if (
    !recognizable &&
    modelList.length === careerCount &&
    unused.has(careerIndex)
  ) {
    return careerIndex;
  }
  return null;
}

function unusedIndexes(
  unused: Set<number>,
  predicate: (index: number) => boolean,
): number[] {
  return [...unused].filter(predicate);
}

function preferPeriod(
  indexes: number[],
  modelList: Record<string, unknown>[],
  periodKey: string,
): number {
  const periodMatch = indexes.find(
    (index) =>
      periodKey &&
      experienceIdentityKey(modelList[index]?.period) === periodKey,
  );
  return periodMatch ?? indexes[0];
}

function companiesAlign(left: string, right: string): boolean {
  if (!left || !right || left === right) return left === right && Boolean(left);
  if (editSimilarity(left, right) >= 0.84) return true;
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 8 && longer.startsWith(`${shorter} `);
}

function editSimilarity(left: string, right: string): number {
  const dist = editDistance(left, right);
  return 1 - dist / Math.max(left.length, right.length);
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let prev = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[prev.length - 1];
}
