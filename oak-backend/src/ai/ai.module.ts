import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersonalModule } from '../personal/personal.module';
import { ProfileLlmAuthService } from './auth/profile-llm-auth.service';
import { WaveBatchRunner } from './batch/wave-batch.runner';
import { LlmAdmissionService } from './concurrency/llm-admission.service';
import { OpenAiChatService } from './openai/openai-chat.service';
import { OpenAiChatStreamService } from './openai/openai-chat-stream.service';

@Module({
  imports: [AuthModule, PersonalModule],
  providers: [
    ProfileLlmAuthService,
    OpenAiChatService,
    OpenAiChatStreamService,
    LlmAdmissionService,
    WaveBatchRunner,
  ],
  exports: [
    ProfileLlmAuthService,
    OpenAiChatService,
    OpenAiChatStreamService,
    LlmAdmissionService,
    WaveBatchRunner,
  ],
})
export class AiModule {}
