import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SignUpDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
