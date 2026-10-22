import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

/** POST /jobs/title-review/approve — mark temp_jobs APPROVED (ready for AI analyze). */
export class ApproveTitleReviewJobsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];

  @IsOptional()
  @IsString()
  applierName?: string;
}
