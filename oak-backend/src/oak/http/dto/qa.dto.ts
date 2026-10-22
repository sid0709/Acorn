import {
  Allow,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class OakQaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  question!: string;

  /** Optional job / page context; same shape as ai-analyze `page`. */
  @IsOptional()
  @Allow()
  page?: Record<string, unknown> | null;
}
