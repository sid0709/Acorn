import { IsOptional, IsString, MinLength } from 'class-validator';

export class StartGenerateDto {
  @IsString()
  @MinLength(1)
  applierName!: string;

  @IsString()
  @MinLength(1)
  jobDescription!: string;

  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}
