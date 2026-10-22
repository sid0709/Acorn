import { IsIn, IsOptional, IsString } from 'class-validator';

/** POST /jobs/persist-recommended-resume — write a previewed Library match. */
export class PersistRecommendedResumeDto {
  @IsString()
  applierName!: string;

  @IsString()
  jobId!: string;

  /** Library stack label from a persist:false recommend preview. */
  @IsString()
  recommendedResumeStack!: string;

  @IsOptional()
  @IsString()
  recommendedResumeReason?: string | null;

  @IsOptional()
  @IsString()
  warning?: string | null;

  @IsOptional()
  @IsIn(['llm', 'heuristic'])
  mode?: 'llm' | 'heuristic';

  @IsOptional()
  @IsString()
  requestId?: string | null;
}
