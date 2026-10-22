import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

function asString(value: unknown): string {
  if (value == null) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return '';
}

export class ListTitleReviewQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim())
  applierName?: string = '';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || 'unreviewed')
  tab?: string = 'unreviewed';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  q?: string = '';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || 'newest')
  sort?: string = 'newest';
}
