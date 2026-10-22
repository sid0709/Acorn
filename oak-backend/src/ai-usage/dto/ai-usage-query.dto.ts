import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

function asString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return '';
}

export class AiUsageQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  since?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  until?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  applierName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  feature?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  runId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class AiUsageMonitorQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  since?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  until?: string;
}
