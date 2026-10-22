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
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'string' || typeof item === 'number'
          ? String(item)
          : '',
      )
      .filter(Boolean)
      .join(',');
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return '';
}

export class ListJobsQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || 'all')
  status?: string = 'all';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  q?: string = '';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  company?: string = '';

  /** Comma-separated sources, or `all` / empty for every source. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  source?: string = '';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  scrapeSource?: string = '';

  /** Comma-separated work modes (`remote`, `hybrid`, `onsite`), or `all` / empty for every mode. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  workMode?: string = '';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  postedFrom?: string = '';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  postedTo?: string = '';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || 'newest')
  sort?: string = 'newest';

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === '1' || value === 'true')
  aiExtracted?: boolean = false;

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

  /** AccountInfo `_id` — loads O(1) status counts + per-job viewer status. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim())
  profileId?: string = '';

  /** AccountInfo name — hydrates vendor_tasks recommend fields on list rows. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim())
  applierName?: string = '';
}
