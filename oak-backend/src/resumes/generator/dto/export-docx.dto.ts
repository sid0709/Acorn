import { Type } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class ExportDocxDto {
  @IsObject()
  model!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  paper?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  marginInches?: number;

  @IsOptional()
  @IsString()
  font?: string;

  @IsOptional()
  @IsString()
  fileName?: string;
}
