import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

function asString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  return '';
}

function asBool(value: unknown): boolean {
  return value === true || value === '1' || value === 'true';
}

export class MailApplierQueryDto {
  @IsString()
  @Transform(({ value }) => asString(value).trim())
  applierName!: string;
}

export class ListThreadsQueryDto extends MailApplierQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || 'inbox')
  folder?: string = 'inbox';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  label?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  search?: string = '';

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => asBool(value))
  unlabeled?: boolean = false;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => asBool(value))
  cacheOnly?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => asBool(value))
  force?: boolean = false;
}

export class GetMessageQueryDto extends MailApplierQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  folder?: string;
}

export class FolderCountsQueryDto extends MailApplierQueryDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => asBool(value))
  force?: boolean = false;
}

function parseLabelQuery(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : value == null ? [] : [value];
  const out: string[] = [];
  for (const part of parts) {
    for (const piece of String(part || '').split(',')) {
      const label = piece.trim();
      if (label) out.push(label);
    }
  }
  return [...new Set(out)];
}

export class MailStatsQueryDto extends MailApplierQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  from?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  to?: string;

  @IsOptional()
  @Transform(({ obj }: { obj: { label?: unknown; labels?: unknown } }) =>
    parseLabelQuery(obj.label ?? obj.labels),
  )
  label?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;
}
