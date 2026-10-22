import { Type } from 'class-transformer';
import {
  Allow,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  DEFAULT_FIRESTORE_SEARCH_OP,
  FIREBASE_EXPLORER_LIMITS,
  FIRESTORE_SEARCH_OPS,
} from '../constants/firebase-explorer.constants';

export class SearchDocumentsDto {
  @IsString()
  path!: string;

  @IsString()
  field!: string;

  @IsOptional()
  @IsIn([...FIRESTORE_SEARCH_OPS])
  op?: string = DEFAULT_FIRESTORE_SEARCH_OP;

  /** Firestore query value — may be string, number, boolean, or JSON-parsed. */
  @IsDefined()
  @Allow()
  value!: unknown;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FIREBASE_EXPLORER_LIMITS.documentsMax)
  limit?: number;
}
