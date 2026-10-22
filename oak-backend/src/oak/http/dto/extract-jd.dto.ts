import {
  Allow,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PAGE_TEXT_MAX_CHARS } from '../../policy/extract-page-text';

export class OakExtractJdDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PAGE_TEXT_MAX_CHARS)
  pageText?: string;

  /** Custom list-item `meta` field when pageText is not sent. */
  @IsOptional()
  @Allow()
  meta?: unknown;
}
