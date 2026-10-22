import { IsOptional, IsString, MinLength } from 'class-validator';

export class OakCustomRecommendDto {
  @IsString()
  @MinLength(1)
  jobDescription!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  url?: string;
}
