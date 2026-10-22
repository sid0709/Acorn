/** Skills section helpers — Skill Coverage no longer constrains generation. */

/** Pass through model-authored Skills JSON unchanged. */
export function normalizeSkillsSectionToContract(
  section: unknown,
  _rawContract: unknown,
) {
  return section;
}

/** Coverage prompt injection removed from generation. */
export function resumeCoveragePrompt(_rawContract: unknown): string {
  return '';
}
