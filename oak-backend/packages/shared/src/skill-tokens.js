/**
 * Word-token extraction for job/profile skill matching.
 *
 * A skill is split into lowercase word tokens on any run of characters that is
 * not a letter, digit, `+`, `#`, or `.` (so `c++`, `c#`, `node.js` survive as
 * single tokens, while `AI/ML System` → ['ai','ml','system'] and
 * `AI-driven Solutions` → ['ai','driven','solutions']).
 *
 * Two skills match when their token sets intersect. This deliberately does NOT
 * collapse separators into one blob, so `Gmail` ('gmail') no longer matches
 * `AI` ('ai') — only a shared *word* counts.
 */

const MIN_TOKEN_LEN = 2;
const MAX_PROFILE_TOKENS = 600;

/**
 * Single-letter tokens are normally noise ("Plan B" → "b"), but a few are real
 * languages that must survive as word tokens so `C` ↔ `C Programming` matches
 * while `Calculation` never does (word match, not substring — the ≥5 compact
 * shim can't fire for 1-char skills either).
 */
const SINGLE_CHAR_SKILLS = new Set(['c', 'r']);

/**
 * Role-agnostic filler words that modify a real skill noun but carry no
 * discriminating signal on their own (e.g. "Backend Development" should not
 * match "Business Development" just because both say "development"). These are
 * dropped from token matching; legitimate whole-skill matches such as
 * `Software → Software Development` are still covered by the ≥5 substring shim
 * in skill-match.js. Distinctive words (design, data, cloud, api, testing,
 * frontend, backend, mobile, web, security…) are intentionally NOT included.
 */
const STOP_TOKENS = new Set([
  'development',
  'management',
  'engineering',
  'solution',
  'solutions',
  'system',
  'systems',
  'application',
  'applications',
  'service',
  'services',
  'framework',
  'frameworks',
  'architecture',
  'programming',
  'platform',
  'platforms',
  'tool',
  'tools',
  'workflow',
  'workflows',
  'pipeline',
  'pipelines',
]);

/**
 * @param {string} skill
 * @returns {string[]} unique word tokens (order preserved)
 */
export function skillTokens(skill) {
  const lower = String(skill ?? '').toLowerCase();
  if (!lower) return [];

  const out = [];
  const seen = new Set();
  for (let part of lower.split(/[^a-z0-9+#.]+/)) {
    part = part.replace(/^\.+|\.+$/g, ''); // trim stray leading/trailing dots (".net" → "net")
    if (part.length < MIN_TOKEN_LEN && !SINGLE_CHAR_SKILLS.has(part)) continue;
    if (!/[a-z0-9]/.test(part)) continue; // must contain a letter/digit (drops "++", "##")
    if (STOP_TOKENS.has(part)) continue;
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out;
}

/**
 * Build a deduped, capped list of profile word tokens from raw skill strings.
 * Returned as an array so it is JSON-serializable for the Redis cache.
 *
 * @param {Iterable<string>} skills
 * @returns {string[]}
 */
export function buildProfileTokens(
  skills = [],
  { max = MAX_PROFILE_TOKENS } = {},
) {
  const seen = new Set();
  for (const raw of skills) {
    for (const token of skillTokens(raw)) {
      seen.add(token);
      if (seen.size >= max) return [...seen];
    }
  }
  return [...seen];
}

export { MIN_TOKEN_LEN, MAX_PROFILE_TOKENS, STOP_TOKENS, SINGLE_CHAR_SKILLS };
