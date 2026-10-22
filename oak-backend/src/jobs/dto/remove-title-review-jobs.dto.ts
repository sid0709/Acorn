import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

/** POST /jobs/title-review/remove — permanent temp_jobs delete. */
export class RemoveTitleReviewJobsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];

  @IsOptional()
  @IsString()
  applierName?: string;
}
