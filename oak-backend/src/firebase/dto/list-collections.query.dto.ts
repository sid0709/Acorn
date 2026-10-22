import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

function asString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return '';
}

export class ListCollectionsQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asString(value))
  parent?: string = '';
}
