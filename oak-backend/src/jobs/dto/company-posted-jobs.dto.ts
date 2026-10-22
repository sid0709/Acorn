import { IsOptional, IsString } from 'class-validator';

/** POST /jobs/company/posted-ids — New (posted) roles at a company, newest first. */
export class CompanyPostedJobsDto {
  @IsString()
  applierName!: string;

  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  keepJobId?: string;
}
