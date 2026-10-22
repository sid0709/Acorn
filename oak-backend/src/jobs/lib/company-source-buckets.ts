export type SourceBucket = {
  source: string;
  lastPostedAt: Date;
  count: number;
  jobIds: string[];
};

function normalizeSource(source: string | null | undefined): string {
  const text = String(source ?? '').trim();
  return text || 'Other';
}

export function cloneSourceBuckets(
  buckets: SourceBucket[] | null | undefined,
): SourceBucket[] {
  return (buckets || []).map((bucket) => ({
    source: bucket.source,
    lastPostedAt: bucket.lastPostedAt,
    count: bucket.count,
    jobIds: [...(bucket.jobIds || [])],
  }));
}

/** Prepend a job onto its source bucket (newest-first). */
export function attachToSourceBuckets(
  buckets: SourceBucket[] | null | undefined,
  input: { source: string; jobId: string; postedAt: Date },
): SourceBucket[] {
  const source = normalizeSource(input.source);
  const next = cloneSourceBuckets(buckets);
  let bucket = next.find((row) => row.source === source);
  if (!bucket) {
    bucket = {
      source,
      lastPostedAt: input.postedAt,
      count: 0,
      jobIds: [],
    };
    next.push(bucket);
  }
  bucket.jobIds = [
    input.jobId,
    ...bucket.jobIds.filter((id) => id !== input.jobId),
  ];
  bucket.count = bucket.jobIds.length;
  if (input.postedAt > bucket.lastPostedAt) {
    bucket.lastPostedAt = input.postedAt;
  }
  return next;
}

/** Strip ids from every bucket. Empty buckets are dropped. */
export function removeFromSourceBuckets(
  buckets: SourceBucket[] | null | undefined,
  removeIds: Set<string>,
): { buckets: SourceBucket[]; headsNeedingPostedAt: string[] } {
  const headsNeedingPostedAt: string[] = [];
  const next: SourceBucket[] = [];
  for (const bucket of cloneSourceBuckets(buckets)) {
    const previousHead = bucket.jobIds[0];
    const jobIds = bucket.jobIds.filter((id) => !removeIds.has(id));
    if (!jobIds.length) continue;
    if (jobIds[0] !== previousHead && jobIds[0]) {
      headsNeedingPostedAt.push(jobIds[0]);
    }
    next.push({
      ...bucket,
      jobIds,
      count: jobIds.length,
    });
  }
  return { buckets: next, headsNeedingPostedAt };
}

export function applyHeadPostedAt(
  buckets: SourceBucket[],
  postedAtById: Map<string, Date>,
): SourceBucket[] {
  return buckets.map((bucket) => {
    const postedAt = postedAtById.get(bucket.jobIds[0] || '');
    return postedAt ? { ...bucket, lastPostedAt: postedAt } : bucket;
  });
}

export function toMongoSourceBuckets(buckets: SourceBucket[]): Array<{
  source: string;
  lastPostedAt: Date;
  count: number;
  jobIds: Array<{ $oid: string }>;
}> {
  return buckets.map((bucket) => ({
    source: bucket.source,
    lastPostedAt: bucket.lastPostedAt,
    count: bucket.count,
    jobIds: bucket.jobIds.map((id) => ({ $oid: id })),
  }));
}
