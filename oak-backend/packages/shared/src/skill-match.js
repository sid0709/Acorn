import { compactSkillText } from './skill-compact.js';
import { skillTokens, buildProfileTokens } from './skill-tokens.js';

const MIN_COMPACT_LEN = 2;
const MAX_PROFILE_COMPACTS = 300;
/** Min length for the substring fallback so short tokens (e.g. "ai") can't match "gmail"/"training". */
const SHIM_MIN_LEN = 5;

/**
 * @typedef {{ profileTokens?: string[]|Set<string>, profileCompacts?: string[], boostCompacts?: string[] }} ProfileMatchContext
 */

export function buildProfileCompacts(
  skills = [],
  { max = MAX_PROFILE_COMPACTS } = {},
) {
  const seen = new Set();
  const out = [];

  for (const raw of skills) {
    const compact = compactSkillText(raw);
    if (!compact || compact.length < MIN_COMPACT_LEN || seen.has(compact))
      continue;
    seen.add(compact);
    out.push(compact);
    if (out.length >= max) break;
  }

  return out;
}

/** @deprecated use buildProfileCompacts */
export const buildBoostCompacts = buildProfileCompacts;

export { buildProfileTokens, skillTokens };

function getProfileCompacts(ctx) {
  if (Array.isArray(ctx?.profileCompacts) && ctx.profileCompacts.length) {
    return ctx.profileCompacts;
  }
  if (Array.isArray(ctx?.boostCompacts) && ctx.boostCompacts.length) {
    return ctx.boostCompacts;
  }
  return [];
}

/** Resolve the profile token Set, caching it on the context object for reuse across many jobs. */
function getProfileTokenSet(ctx) {
  if (!ctx || typeof ctx !== 'object') return new Set();
  if (ctx._profileTokenSet instanceof Set) return ctx._profileTokenSet;
  const raw = ctx.profileTokens;
  const set = raw instanceof Set ? raw : new Set(Array.isArray(raw) ? raw : []);
  try {
    ctx._profileTokenSet = set;
  } catch {
    /* frozen ctx */
  }
  return set;
}

/**
 * Whether a job requirement is satisfied by any profile skill.
 * Primary rule: the job skill shares a word token with the profile
 * (AI/ML → AI ✅, Gmail → AI ❌). Fallback: substring containment, but only for
 * tokens of length ≥ 5 so short tokens can't create false positives.
 */
export function jobSkillMatchesProfile(jobSkill, ctx) {
  const tokens = skillTokens(jobSkill);
  if (!tokens.length) return false;

  const profileTokens = getProfileTokenSet(ctx);
  if (profileTokens.size) {
    for (const token of tokens) {
      if (profileTokens.has(token)) return true;
    }
  }

  const profileCompacts = getProfileCompacts(ctx);
  if (profileCompacts.length) {
    const jobCompact = compactSkillText(jobSkill);
    if (jobCompact) {
      for (const profile of profileCompacts) {
        if (profile.length < SHIM_MIN_LEN) continue;
        if (jobCompact.includes(profile)) return true;
        if (jobCompact.length >= SHIM_MIN_LEN && profile.includes(jobCompact))
          return true;
      }
    }
  }

  return false;
}

/**
 * Weighted variant of jobSkillMatchesProfile: returns the weight of the best
 * matching profile skill (0 = no match). The context carries pre-computed
 * weights (category weight × level factor baked in server-side):
 *   ctx.tokenWeights:   { [wordToken]: weight }
 *   ctx.compactWeights: [{ c: compactText, w: weight }]  // ≥5-char shim only
 * Matching rules are identical to the boolean matcher — shared word token
 * first, then the ≥5-char compact substring shim.
 *
 * @param {string} jobSkill
 * @param {{ tokenWeights?: Record<string, number>, compactWeights?: {c: string, w: number}[] }} ctx
 * @returns {number} best matching weight, 0 when unmatched
 */
export function jobSkillMatchWeight(jobSkill, ctx) {
  const tokens = skillTokens(jobSkill);
  if (!tokens.length) return 0;

  let best = 0;
  const tokenWeights = ctx?.tokenWeights;
  if (tokenWeights) {
    for (const token of tokens) {
      const w = tokenWeights[token];
      if (typeof w === 'number' && w > best) best = w;
    }
  }

  const compactWeights = ctx?.compactWeights;
  if (Array.isArray(compactWeights) && compactWeights.length) {
    const jobCompact = compactSkillText(jobSkill);
    if (jobCompact) {
      for (const { c, w } of compactWeights) {
        if (typeof w !== 'number' || w <= best) continue;
        if (!c || c.length < SHIM_MIN_LEN) continue;
        if (jobCompact.includes(c)) best = w;
        else if (jobCompact.length >= SHIM_MIN_LEN && c.includes(jobCompact))
          best = w;
      }
    }
  }

  return best;
}

/**
 * Proficiency of the best user skill matching a job skill (0 = no match).
 * Identical resolution to jobSkillMatchWeight — the weight maps now carry the
 * user's 0..1 proficiencyFactor (category is applied job-side at score time).
 */
export const matchProficiency = jobSkillMatchWeight;

/**
 * @param {string[]} jobSkills display or canonical job skills
 * @param {ProfileMatchContext} ctx
 */
export function computeSkillHighlights(jobSkills = [], ctx) {
  return jobSkills.map((name) => ({
    name: String(name),
    matched: jobSkillMatchesProfile(name, ctx),
  }));
}
