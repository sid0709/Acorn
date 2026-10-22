declare module '@nextoffer/shared/skill-normalize' {
  export const STATIC_ALIASES: Record<string, string[]>;
  export function toCanonical(skill: string): string;
  export function normalizeSkillSet(skills?: string[]): Set<string>;
  export function normalizeRaw(skill: string): string;
}
