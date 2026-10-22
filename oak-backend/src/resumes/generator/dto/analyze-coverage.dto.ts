import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class AnalyzeCoverageDto {
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
  @IsObject()
  identity?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  coverage?: {
    aliases?: Record<string, string[]>;
    experienceRequirementThreshold?: number;
  };
}
