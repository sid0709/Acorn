import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/** POST /jobs/apply/bulk — mark jobs applied in `job_statuses`. */
export class ApplyJobsBulkDto {
  @IsString()
  applierName!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  jobIds!: string[];
}
