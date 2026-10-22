import { IsString } from 'class-validator';

export class SetRecommendedResumeDto {
  @IsString()
  applierName!: string;

  @IsString()
  jobId!: string;

  /** Library resume id (`Resume.id`) — stack label is taken from `Resume.title`. */
  @IsString()
  resumeId!: string;
}
