import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateIncidentDto {
  @IsString()
  @MaxLength(80)
  component!: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsString()
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  severity?: string;
}
