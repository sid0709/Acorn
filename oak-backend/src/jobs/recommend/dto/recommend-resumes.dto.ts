import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ArrayMaxSize,
} from 'class-validator';

/** Max jobs per recommend-resumes bulk request (legacy Athens-server contract). */
const MAX_RECOMMEND_JOBS = 40;

export class RecommendResumesDto {
  @IsString()
  applierName!: string;

  @IsArray()
  @ArrayMaxSize(MAX_RECOMMEND_JOBS)
  @IsString({ each: true })
  jobIds!: string[];

  /**
   * When false, jobs that already have a Library recommendation (or customized
   * fallback) are skipped without calling the LLM. Default true = replace.
   */
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;

  /**
   * When false, run AI and return stacks without writing vendor_tasks.
   * Posted (New) jobs are allowed. Default true = persist (Bid ready / Worker pool only).
   */
  @IsOptional()
  @IsBoolean()
  persist?: boolean;
}
