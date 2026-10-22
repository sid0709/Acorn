import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class OakMatchOptionDto {
  @IsString()
  @MinLength(1)
  intendedValue!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  options!: string[];

  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string')
  @IsString()
  fieldLabel?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string')
  @IsString()
  typedQuery?: string | null;
}
