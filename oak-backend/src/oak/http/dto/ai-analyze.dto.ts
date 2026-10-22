import { Allow, IsOptional, IsString, MinLength } from 'class-validator';

export class OakAiAnalyzeDto {
  @IsString()
  @MinLength(1)
  pureTree!: string;

  /**
   * Structural twin of pureTree. Still accepted so older extensions keep working,
   * but the planner reads pureTree only — control attrs now ride on pure `detail`.
   */
  @IsOptional()
  @IsString()
  metaTree?: string;

  /** Opaque page metadata from the extension; null/object both accepted. */
  @IsOptional()
  @Allow()
  page?: Record<string, unknown> | null;
}
