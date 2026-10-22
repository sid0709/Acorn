import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

/** POST /jobs/company/apply-others — mark other roles at a company applied. */
export class ApplyOtherCompanyJobsDto {
  @IsString()
  applierName!: string;

  @IsString()
  companyId!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  keepJobIds!: string[];

  /** When true, also mark bid-ready / worker-pool / bid-completed siblings. */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === '1' || value === 'true')
  includeQueued?: boolean;

  @IsOptional()
  @IsString()
  mutationId?: string;
}
