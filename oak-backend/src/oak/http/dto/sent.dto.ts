import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MAX_URL = 2048;
const MAX_TITLE = 200;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_STEPS = 100_000;
/** UTC offsets run from UTC-12 to UTC+14. */
const MIN_OFFSET_MINUTES = -12 * 60;
const MAX_OFFSET_MINUTES = 14 * 60;

export class OakSentDto {
  @IsString()
  @MaxLength(MAX_URL)
  url!: string;

  @IsString()
  @MaxLength(MAX_TITLE)
  title!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_DURATION_MS)
  durationMs!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_STEPS)
  steps!: number;

  @IsOptional()
  @IsInt()
  endedAt?: number;

  @IsInt()
  @Min(MIN_OFFSET_MINUTES)
  @Max(MAX_OFFSET_MINUTES)
  utcOffsetMinutes!: number;

  /** Base64 JPEG of the whole page, without a data: prefix. */
  @IsString()
  @MinLength(1)
  screenshot!: string;
}
