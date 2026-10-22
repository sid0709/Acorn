import { IsArray, IsOptional, IsString, ArrayMaxSize } from 'class-validator';

/** POST /jobs/remove — permanent catalog delete. */
export class RemoveJobsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}

/** POST /jobs/company/remove-others — hard-delete sibling roles. */
export class RemoveOtherCompanyJobsDto {
  @IsString()
  companyId!: string;

  @IsString()
  keepJobId!: string;

  @IsOptional()
  @IsString()
  profileId?: string;
}
