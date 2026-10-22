import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GetAutoBidProfileQueryDto {
  @IsString()
  @IsNotEmpty()
  applierName!: string;

  @IsOptional()
  @IsString()
  profileId?: string;
}
