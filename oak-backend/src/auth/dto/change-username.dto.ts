import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  USERNAME_PATTERN,
} from '../constants/username.constants';

export class ChangeUsernameDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @MinLength(MIN_USERNAME_LENGTH)
  @MaxLength(MAX_USERNAME_LENGTH)
  @Matches(USERNAME_PATTERN, {
    message:
      'Username must use only letters, numbers, dots, hyphens, or underscores',
  })
  newName!: string;

  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}
