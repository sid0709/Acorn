import { Module } from '@nestjs/common';
import { ProfileLlmAuthService } from './auth/profile-llm-auth.service';
import { OpenAiChatService } from './openai/openai-chat.service';

@Module({
  providers: [ProfileLlmAuthService, OpenAiChatService],
  exports: [ProfileLlmAuthService, OpenAiChatService],
})
export class AiModule {}
