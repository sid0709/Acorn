import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateExtensionDto {
  @IsString()
  key!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  label?: string;

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
