import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  confirmName!: string;
}
