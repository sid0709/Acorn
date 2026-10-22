import { Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import { AccountInfoService } from '../../auth/account-info.service';
import { PURPOSE_SET } from './constants/generator.constants';
import { cleanString } from './lib/clean-string';

export type PrepareGenerationOk = {
  ok: true;
  providerId: string;
  model: string;
  apiKey: string;
  steps: Record<string, unknown>[];
  isBeta: boolean;
  dynamicCareerTitles: boolean;
  /** Skill Coverage is no longer applied to generation. */
  coverageContract: null;
  profileId: string;
  applierName: string;
};

export type PrepareGenerationErr = {
  ok: false;
  status: number;
  error: string;
};

@Injectable()
export class ResumeGeneratePrepareService {
  constructor(
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly accounts: AccountInfoService,
  ) {}

  async prepare(
    body: Record<string, unknown>,
  ): Promise<PrepareGenerationOk | PrepareGenerationErr> {
    const steps = Array.isArray(body.steps)
      ? (body.steps as Record<string, unknown>[])
      : [];
    if (!steps.length) {
      return { ok: false, status: 400, error: 'steps are required' };
    }

    let auth;
    try {
      auth = await this.llmAuth.resolve({
        applierName: cleanString(body.applierName),
        profileId: cleanString(body.profileId) || undefined,
        provider: cleanString(body.provider) || undefined,
        model: cleanString(body.model) || undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, error: message };
    }

    const finalsByPurpose: Record<string, number> = {};
    for (const step of steps) {
      const purpose = cleanString(step?.purpose);
      if (step?.kind === 'final' && PURPOSE_SET.has(purpose)) {
        finalsByPurpose[purpose] = (finalsByPurpose[purpose] || 0) + 1;
      }
    }
    const bad = Object.entries(finalsByPurpose).find(([, n]) => n !== 1);
    if (bad) {
      return {
        ok: false,
        status: 400,
        error: `${bad[0]} must have exactly one final step (found ${bad[1]}).`,
      };
    }

    const account = await this.accounts.findByName(auth.applierName);
    const isBeta =
      String(account?.tier ?? '')
        .trim()
        .toLowerCase() === 'beta';

    return {
      ok: true,
      providerId: auth.provider,
      model: auth.model,
      apiKey: auth.apiKey,
      steps,
      isBeta,
      dynamicCareerTitles: body.dynamicCareerTitles === true,
      coverageContract: null,
      profileId: auth.profileId,
      applierName: auth.applierName,
    };
  }
}
