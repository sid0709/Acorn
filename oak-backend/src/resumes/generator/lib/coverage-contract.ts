/** Public coverage-contract API for resume generation. */
export {
  buildAutomaticResumeCoveragePayload,
  buildResumeCoverageContract,
  normalizeResumeCoverageContract,
} from './coverage-contract-core';
export {
  normalizeSkillsSectionToContract,
  resumeCoveragePrompt,
} from './coverage-skills-normalize';
