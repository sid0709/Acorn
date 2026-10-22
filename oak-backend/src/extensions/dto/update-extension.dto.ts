import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateExtensionDto {
  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
