import { IsOptional, IsString } from 'class-validator';

export class GetLlmModelsQueryDto {
  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  applierName?: string;

  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsString()
  force?: string;
}
