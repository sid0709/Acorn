/**
 * Compact skill text for fuzzy containment matching.
 * Lowercase; strip spaces, punctuation, and symbols (keeps + and . for C++ / Node.js).
 */
export function compactSkillText(skill) {
  return String(skill ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-–—_,;:()[\]{}'"`\\/|]/g, '');
}
