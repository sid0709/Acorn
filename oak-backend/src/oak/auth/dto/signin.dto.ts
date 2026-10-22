import { IsString, MinLength } from 'class-validator';

export class OakSignInDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
