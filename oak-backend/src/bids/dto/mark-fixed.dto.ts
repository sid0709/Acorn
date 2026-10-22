import { IsOptional, IsString } from 'class-validator';

export class MarkFixedDto {
  @IsString()
  applierName!: string;

  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @IsString()
  id?: string;
}
