import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

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

export class GetJobQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim())
  applierName?: string = '';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim())
  profileId?: string = '';
}
