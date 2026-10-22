import { Injectable } from '@nestjs/common';
import { AccountInfoRepository } from '../auth/account-info.repository';
import { MAIL_DEFINITION_MAX_CHARS } from './constants/mail.constants';

@Injectable()
export class MailLabelDefinitionsService {
  constructor(private readonly accounts: AccountInfoRepository) {}

  normalize(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      const k = String(key || '').trim();
      if (!k) continue;
      out[k] = String(value ?? '')
        .trim()
        .slice(0, MAIL_DEFINITION_MAX_CHARS);
    }
    return out;
  }

  async get(applierName: string): Promise<Record<string, string>> {
    const acc = await this.accounts.findByExactName(applierName);
    if (!acc) return {};
    const primary = this.normalize(acc.mailAiLabelDefinitions);
    if (Object.keys(primary).length) return primary;
    // Legacy migrate-once from autoBidProfile.mailLabelDefinitions
    const profile =
      acc.autoBidProfile &&
      typeof acc.autoBidProfile === 'object' &&
      !Array.isArray(acc.autoBidProfile)
        ? (acc.autoBidProfile as Record<string, unknown>)
        : {};
    const legacy = this.normalize(profile.mailLabelDefinitions);
    if (Object.keys(legacy).length) {
      await this.save(applierName, legacy);
      return legacy;
    }
    return {};
  }

  async save(
    applierName: string,
    definitions: Record<string, string>,
  ): Promise<Record<string, string>> {
    const normalized = this.normalize(definitions);
    await this.accounts.updateByName(applierName, {
      mailAiLabelDefinitions: normalized,
    });
    return normalized;
  }
}
