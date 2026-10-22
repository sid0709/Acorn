import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountInfoRepository } from '../../auth/account-info.repository';

const SECRET_PROFILE_FIELDS = [
  'openaiApiKey',
  'deepseekApiKey',
  'gmailPassword',
  'gmailAppPassword',
  'defaultPassword',
] as const;

const EMPTY_PROFILE_NOTE =
  'No applicant profile provided. Use {{PLACEHOLDER}} values for any required applicant data.';

/**
 * Build planner context from the saved Athens Profile settings object.
 * No parallel display-label dictionaries — values come from Settings as stored.
 */
function buildApplicantContext(
  account: { id: string; name: string | null },
  profile: Record<string, unknown>,
): string {
  const education = Array.isArray(profile.education) ? profile.education : [];
  const careers = Array.isArray(profile.careers) ? profile.careers : [];

  return JSON.stringify(
    {
      source: 'Athens Profile settings (saved autoBidProfile)',
      account: { id: account.id, name: account.name },
      /**
       * Field keys match Profile settings controls. Values are exactly what the
       * applicant saved (including snake_case option codes). Match form options
       * to these facts; do not invent alternate answers.
       */
      settings: {
        fullName: profile.fullName ?? null,
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
        age: profile.age ?? null,
        gender: profile.gender ?? null,
        pronouns: profile.pronouns ?? null,
        sexualOrientation: profile.sexualOrientation ?? null,
        email: profile.email ?? null,
        phone: profile.phone ?? null,
        address: profile.address ?? null,
        city: profile.city ?? null,
        state: profile.state ?? null,
        zipCode: profile.zipCode ?? null,
        country: profile.country ?? null,
        /** Profile settings control: Citizenship */
        immigrationStatus: profile.immigrationStatus ?? null,
        /** Profile settings control: Visa / sponsorship */
        sponsorship: profile.sponsorship ?? null,
        /** Profile settings control: Hispanic / Latino */
        demographicHispanic: profile.demographicHispanic ?? null,
        /** Profile settings control: Race / ethnicity */
        demographicRaceEthnicity: profile.demographicRaceEthnicity ?? null,
        /** Profile settings control: Disability */
        demographicDisability: profile.demographicDisability ?? null,
        /** Profile settings control: Veteran status */
        demographicMilitaryStatus: profile.demographicMilitaryStatus ?? null,
        linkedin: profile.linkedin ?? null,
        github: profile.github ?? null,
        portfolioUrl: profile.portfolioUrl ?? null,
        desiredSalary: profile.desiredSalary ?? null,
        education,
        careers,
      },
      note: [
        'settings.* is the authoritative applicant profile from Athens Settings.',
        'immigrationStatus is Citizenship; sponsorship is Visa/sponsorship; demographic* are Voluntary disclosures.',
        'Map immigrationStatus onto work-authorization questions (a status that already permits work is Yes). Map sponsorship onto visa-sponsorship questions only.',
        'education[].school / diploma and careers[] are Education and work history.',
        'Enum-like codes are stored as saved (e.g. us_citizen, not_protected, prefer_not_say, asian) — map them semantically to each form option label.',
        'How-did-you-hear / job-source: choose the listed option that matches the professional network already on the profile (settings.linkedin, else github / portfolioUrl).',
        'The applicant is a human. Never describe them as an AI, bot, or automation tool; never answer that they used AI/automation to apply; never consent to AI or automated employment decision / screening tools.',
      ].join(' '),
    },
    null,
    2,
  );
}

@Injectable()
export class OakProfilePromptService {
  constructor(private readonly accounts: AccountInfoRepository) {}

  async buildApplicantProfileText(profileId: string): Promise<string> {
    const account = await this.accounts.findById(profileId);
    if (!account) {
      throw new NotFoundException({
        success: false,
        message: 'Account not found for Oak profile.',
      });
    }

    const raw =
      account.autoBidProfile &&
      typeof account.autoBidProfile === 'object' &&
      !Array.isArray(account.autoBidProfile)
        ? { ...(account.autoBidProfile as Record<string, unknown>) }
        : null;

    if (!raw || Object.keys(raw).length === 0) {
      return EMPTY_PROFILE_NOTE;
    }

    for (const field of SECRET_PROFILE_FIELDS) {
      delete raw[field];
    }
    delete raw.openaiApiKeyConfigured;
    delete raw.deepseekApiKeyConfigured;

    return buildApplicantContext({ id: account.id, name: account.name }, raw);
  }
}
