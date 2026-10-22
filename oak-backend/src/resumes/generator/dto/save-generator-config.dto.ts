import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class SaveGeneratorConfigDto {
  @IsString()
  @MinLength(1)
  applierName!: string;

  @IsObject()
  config!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  profileId?: string;
}
