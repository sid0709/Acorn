import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { JobStatusApplierDto } from './job-status-mutate.dto';

/** POST /jobs/:id/worker-pool — status WorkerPool | clear */
export class UpdateJobWorkerPoolDto extends JobStatusApplierDto {
  @IsString()
  status!: string;
}

class BulkWorkerPoolJobRefDto {
  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  catalog?: string;
}

/** POST /jobs/worker-pool/bulk */
export class BulkWorkerPoolDto {
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
  @Type(() => BulkWorkerPoolJobRefDto)
  jobs!: BulkWorkerPoolJobRefDto[];
}
