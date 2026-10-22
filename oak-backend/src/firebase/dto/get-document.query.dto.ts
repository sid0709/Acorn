import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';

function asString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return '';
}

export class GetDocumentQueryDto {
  @IsString()
  @Transform(({ value }) => asString(value).trim())
  path!: string;
}
