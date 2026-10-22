import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

function asTrimmedString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class VendorPasswordDto {
  @Transform(asTrimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  applierName!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  vendorPassword?: string;

  @IsOptional()
  @IsBoolean()
  clear?: boolean;
}
