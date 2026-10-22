import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

function asTrimmed(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  return '';
}

/** Query for Bid Management spreadsheet rows. */
export class BidReportQueryDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => asTrimmed(value))
  applierName!: string;

  /** Inclusive folder-day start (`YYYY-MM-DD` or ISO). Empty = All. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asTrimmed(value) || undefined)
  since?: string;

  /** Inclusive folder-day end (`YYYY-MM-DD` or ISO). Empty = All. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asTrimmed(value) || undefined)
  until?: string;
}
