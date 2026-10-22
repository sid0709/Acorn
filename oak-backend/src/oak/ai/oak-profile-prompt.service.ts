import { Injectable } from '@nestjs/common';
import { AcornProfileService } from '../../acorn/acorn-profile.service';

/**
 * Planner context from the account's saved Acorn profile. The profile goes in as
 * saved (secrets removed): no parallel label dictionaries, and the model maps
 * each stored value onto the form's own options.
 */
function buildApplicantContext(
  account: { id: string },
  profile: Record<string, unknown>,
): string {
  return JSON.stringify(
    {
      source: 'Acorn profile (saved on the Acorn website)',
      account: { id: account.id },
      settings: profile,
      note: [
        'settings.* is the authoritative applicant profile from Acorn.',
        'settings.citizenship and settings.workAuthorized answer work-authorization questions; settings.visaSponsorship answers visa-sponsorship questions only.',
        'settings.hispanicLatino, raceEthnicity, disability and veteranStatus are voluntary disclosures.',
        'settings.timeline lists roles (kind "experience") and schools (kind "education"), newest first, with start / end month and year, org, title and summary.',
        'Values are stored as the person chose them; map them semantically to each form option label.',
        'How-did-you-hear / job-source: choose the listed option that matches the professional network already on the profile (settings.linkedin, else settings.github / settings.portfolio).',
        'The applicant is a human. Never describe them as an AI, bot, or automation tool; never answer that they used AI/automation to apply; never consent to AI or automated employment decision / screening tools.',
      ].join(' '),
    },
    null,
    2,
  );
}

@Injectable()
export class OakProfilePromptService {
  constructor(private readonly profiles: AcornProfileService) {}

  async buildApplicantProfileText(accountId: string): Promise<string> {
    const profile = await this.profiles.loadForPrompt(accountId);
    return buildApplicantContext({ id: accountId }, profile);
  }
}
