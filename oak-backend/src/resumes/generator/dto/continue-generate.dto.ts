import { IsString, MinLength } from 'class-validator';

export class ContinueGenerateDto {
  @IsString()
  @MinLength(1)
  applierName!: string;
}
