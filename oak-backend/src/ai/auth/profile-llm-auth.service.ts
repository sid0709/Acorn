import { BadRequestException, Injectable } from '@nestjs/common';
import { AcornProfileService } from '../../acorn/acorn-profile.service';
import type { ChatProvider } from '../openai/openai.types';

/** Acorn calls its model through OpenRouter; the profile's OpenAI key is the fallback. */
const OPENROUTER_MODEL =
  process.env.OAK_OPENROUTER_MODEL?.trim() || 'openai/gpt-6-luna';
const OPENAI_MODEL = process.env.OAK_OPENAI_MODEL?.trim() || 'gpt-6-luna';

export type ProfileLlmAuth = {
  profileId: string;
  applierName: string;
  provider: ChatProvider;
  model: string;
  apiKey: string;
};

/** Resolve the signed-in account's model key from its Acorn profile (never a server env key). */
@Injectable()
export class ProfileLlmAuthService {
  constructor(private readonly profiles: AcornProfileService) {}

  async resolve(input: {
    profileId: string;
    applierName?: string;
  }): Promise<ProfileLlmAuth> {
    const profile = await this.profiles.load(input.profileId);
    const openrouter = text(profile.openrouterApiKey);
    const openai = text(profile.openaiApiKey);
    const base = {
      profileId: input.profileId,
      applierName: input.applierName ?? '',
    };
    if (openrouter) {
      return {
        ...base,
        provider: 'openrouter',
        model: OPENROUTER_MODEL,
        apiKey: openrouter,
      };
    }
    if (openai) {
      return {
        ...base,
        provider: 'openai',
        model: OPENAI_MODEL,
        apiKey: openai,
      };
    }
    throw new BadRequestException({
      success: false,
      message:
        'No OpenRouter or OpenAI key in the Acorn profile. Add one on the website and save.',
      error: 'No model API key in profile.',
    });
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
