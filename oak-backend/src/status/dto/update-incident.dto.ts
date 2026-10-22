import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateIncidentDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
