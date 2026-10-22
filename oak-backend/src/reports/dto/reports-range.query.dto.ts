import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

function asTrimmed(value: unknown): string {
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
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  return '';
}

/** Shared date-range query for Analytics report endpoints. */
export class ReportsRangeQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asTrimmed(value) || undefined)
  applierName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asTrimmed(value) || undefined)
  startDate?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asTrimmed(value) || undefined)
  endDate?: string;

  /** Comma-separated scrape sources (`createdBy` keys), or empty for every source. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asTrimmed(value) || undefined)
  scrapeSource?: string;

  /** Comma-separated job sources (board titles), or empty for every source. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asTrimmed(value) || undefined)
  source?: string;
}
