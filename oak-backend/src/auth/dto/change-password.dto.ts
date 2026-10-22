import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { MIN_NEW_PASSWORD_LENGTH } from '../constants/auth.constants';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(MIN_NEW_PASSWORD_LENGTH)
  newPassword!: string;
}
