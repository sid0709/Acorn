import { BadRequestException, Injectable } from '@nestjs/common';
import { AcornProfileService } from '../../acorn/acorn-profile.service';
import type { ChatProvider } from '../openai/openai.types';

/**
 * Oak's planner and follow-up calls use GPT-6 Luna on OpenAI's own API, with the profile's OpenAI
 * key. OpenRouter is only for Jev, which acorn-backend calls.
 */
const OPENAI_MODEL = process.env.OAK_OPENAI_MODEL?.trim() || 'gpt-6-luna';

export type ProfileLlmAuth = {
  profileId: string;
  applierName: string;
  provider: ChatProvider;
  model: string;
  apiKey: string;
};

/** Resolve the signed-in account's OpenAI key from its Acorn profile (never a server env key). */
@Injectable()
export class ProfileLlmAuthService {
  constructor(private readonly profiles: AcornProfileService) {}

  async resolve(input: {
    profileId: string;
    applierName?: string;
  }): Promise<ProfileLlmAuth> {
    const profile = await this.profiles.load(input.profileId);
    const apiKey =
      typeof profile.openaiApiKey === 'string'
        ? profile.openaiApiKey.trim()
        : '';
    if (!apiKey) {
      throw new BadRequestException({
        success: false,
        message:
          'No OpenAI key in the Acorn profile. Oak fills pages with GPT-6 on OpenAI: add the key on the website and save.',
        error: 'No OpenAI API key in profile.',
      });
    }
    return {
      profileId: input.profileId,
      applierName: input.applierName ?? '',
      provider: 'openai',
      model: OPENAI_MODEL,
      apiKey,
    };
  }
}
