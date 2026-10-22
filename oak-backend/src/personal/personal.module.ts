import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutoBidProfileService } from './auto-bid-profile.service';
import { LlmKeyService } from './llm/llm-key.service';
import { PersonalLlmService } from './llm/personal-llm.service';
import { PersonalController } from './personal.controller';
import { ProfileSecretsService } from './secrets/profile-secrets.service';

@Module({
  imports: [AuthModule],
  controllers: [PersonalController],
  providers: [
    AutoBidProfileService,
    ProfileSecretsService,
    LlmKeyService,
    PersonalLlmService,
  ],
  exports: [ProfileSecretsService, PersonalLlmService],
})
export class PersonalModule {}
