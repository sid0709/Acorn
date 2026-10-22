import {
  RESUME_SKILL_CATEGORIES,
  RESUME_SKILL_CATEGORY_LIMITS,
  RESUME_SKILL_LEVEL_MAX,
  RESUME_SKILL_LEVEL_MIN,
  RESUME_SKILL_TOTAL_LIMIT,
  RESUME_SKILL_TRIM_MIN_LEVEL,
  type ResumeSkillCategory,
} from '../constants/resume-skill.constants';
import type { ResumeSkillEntry } from '../mappers/resume.mapper';

function normalizeCategory(raw: unknown): ResumeSkillCategory {
  const c = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (RESUME_SKILL_CATEGORIES as readonly string[]).includes(c)
    ? (c as ResumeSkillCategory)
    : 'hard';
}

function normalizeLevel(raw: unknown, legacyStrength?: unknown): number {
  if (raw != null && raw !== '') {
    const n = Number.parseInt(String(raw), 10);
    if (Number.isFinite(n)) {
      return Math.max(
        RESUME_SKILL_LEVEL_MIN,
        Math.min(RESUME_SKILL_LEVEL_MAX, n),
      );
    }
  }
  const s = Number(legacyStrength);
  if (Number.isFinite(s) && s > 0) {
    if (s <= RESUME_SKILL_LEVEL_MAX) {
      return Math.max(
        RESUME_SKILL_LEVEL_MIN,
        Math.min(RESUME_SKILL_LEVEL_MAX, Math.round(s)),
      );
    }
    return Math.max(
      RESUME_SKILL_LEVEL_MIN,
      Math.min(RESUME_SKILL_LEVEL_MAX, Math.round(s / 2)),
    );
  }
  return 3;
}

export function normalizeResumeSkillEntry(
  item: unknown,
): ResumeSkillEntry | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  const name = String(rec.name ?? rec.skill ?? '').trim();
  if (!name) return null;
  return {
    name,
    category: normalizeCategory(rec.category),
    level: normalizeLevel(rec.level, rec.strength ?? rec.score),
  };
}

function compareSkills(a: ResumeSkillEntry, b: ResumeSkillEntry): number {
  if (b.level !== a.level) return b.level - a.level;
  return a.name.localeCompare(b.name);
}

/** Keep highest-level skills per category up to configured caps. */
export function capResumeSkillProfile(
  skills: unknown[] = [],
): ResumeSkillEntry[] {
  const normalized = skills
    .map((item) => normalizeResumeSkillEntry(item))
    .filter((x): x is ResumeSkillEntry => Boolean(x))
    .sort(compareSkills);

  const byCategory = new Map<string, ResumeSkillEntry[]>();
  for (const cat of RESUME_SKILL_CATEGORIES) {
    byCategory.set(cat, []);
  }
  for (const entry of normalized) {
    byCategory.get(entry.category)?.push(entry);
  }

  const capped: ResumeSkillEntry[] = [];
  for (const cat of RESUME_SKILL_CATEGORIES) {
    const list = byCategory.get(cat) || [];
    const limit = RESUME_SKILL_CATEGORY_LIMITS[cat];
    const trimmed = list
      .filter(
        (s) => s.level >= RESUME_SKILL_TRIM_MIN_LEVEL || list.length <= limit,
      )
      .slice(0, limit);
    capped.push(...trimmed);
  }

  return capped.sort(compareSkills).slice(0, RESUME_SKILL_TOTAL_LIMIT);
}

/** Parse LLM JSON — accepts `{ skills: [...] }` or a bare array. */
export function parseSkillProfileJson(content: string): ResumeSkillEntry[] {
  const raw = String(content || '').trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const startArr = raw.indexOf('[');
    const useArr = startArr >= 0 && (start < 0 || startArr < start);
    const from = useArr ? startArr : start;
    if (from < 0) return [];
    const endChar = useArr ? ']' : '}';
    const end = raw.lastIndexOf(endChar);
    if (end <= from) return [];
    try {
      parsed = JSON.parse(raw.slice(from, end + 1));
    } catch {
      return [];
    }
  }

  if (Array.isArray(parsed)) return capResumeSkillProfile(parsed);
  if (parsed && typeof parsed === 'object') {
    const skills = (parsed as { skills?: unknown }).skills;
    if (Array.isArray(skills)) return capResumeSkillProfile(skills);
  }
  return [];
}
