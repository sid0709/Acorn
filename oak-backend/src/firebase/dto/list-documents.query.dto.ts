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

export class ListDocumentsQueryDto {
  @IsString()
  @Transform(({ value }) => asString(value).trim())
  path!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FIREBASE_EXPLORER_LIMITS.documentsMax)
  limit?: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  cursor?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value).trim() || undefined)
  orderField?: string;
}
