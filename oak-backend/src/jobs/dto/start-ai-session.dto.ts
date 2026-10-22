import { IsOptional, IsString } from 'class-validator';

/** Start Title Review or AI Analyze session for a signed-in profile. */
export class StartAiSessionDto {
  @IsOptional()
  @IsString()
  applierName?: string;

  @IsOptional()
  @IsString()
  profileId?: string;
}
