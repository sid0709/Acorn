import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/** Shared body fields for single-job status mutations. */
export class JobStatusApplierDto {
  @IsString()
  applierName!: string;

  @IsOptional()
  @IsString()
  catalog?: string;

  @IsOptional()
  @IsString()
  mutationId?: string;
}

/** POST /jobs/:id/status */
export class UpdateJobPipelineStatusDto extends JobStatusApplierDto {
  @IsString()
  status!: string;
}

/** POST /jobs/:id/bid-status */
export class UpdateJobBidStatusDto extends JobStatusApplierDto {
  @IsString()
  status!: string;
}

class BulkBidJobRefDto {
  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  catalog?: string;
}

/** POST /jobs/bid-status/bulk */
export class BulkBidStatusDto {
  @IsString()
  applierName!: string;

  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  mutationId?: string;

  @IsArray()
  @ArrayMaxSize(150)
  @ValidateNested({ each: true })
  @Type(() => BulkBidJobRefDto)
  jobs!: BulkBidJobRefDto[];
}
