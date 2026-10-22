import { IsString, MinLength } from 'class-validator';

export class OakCustomGenerateDto {
  @IsString()
  @MinLength(1)
  jobDescription!: string;
}
