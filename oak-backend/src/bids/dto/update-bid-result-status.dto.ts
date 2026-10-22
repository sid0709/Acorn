import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBidResultStatusDto {
  @IsString()
  applierName!: string;

  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rejectReason?: string;
}
