export function rewriteStringPath(
  value: string | null | undefined,
  oldPrefix: string,
  newPrefix: string,
): string | null {
  const path = String(value || '');
  if (!path.startsWith(oldPrefix)) return value ?? null;
  return `${newPrefix}${path.slice(oldPrefix.length)}`;
}

export function rewriteJsonPaths(
  value: unknown,
  oldPrefix: string,
  newPrefix: string,
): unknown {
  if (typeof value === 'string') {
    return rewriteStringPath(value, oldPrefix, newPrefix) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonPaths(item, oldPrefix, newPrefix));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = rewriteJsonPaths(item, oldPrefix, newPrefix);
    }
    return out;
  }
  return value;
}
