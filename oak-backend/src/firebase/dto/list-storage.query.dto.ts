import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { FIREBASE_EXPLORER_LIMITS } from '../constants/firebase-explorer.constants';

function asString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return '';
}

export class ListStorageQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  prefix?: string = '';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  pageToken?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FIREBASE_EXPLORER_LIMITS.storageMax)
  limit?: number;
}
