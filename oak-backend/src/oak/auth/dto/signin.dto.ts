import { IsString, MinLength } from 'class-validator';

/** The Acorn account email and the extension password from the Acorn profile. */
export class OakSignInDto {
  @IsString()
  @MinLength(1)
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
