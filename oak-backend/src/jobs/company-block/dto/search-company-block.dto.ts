import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { COMPANY_BLOCK_NAME_MAX } from '../constants/company-block.constants';

export class SearchCompanyBlockDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMPANY_BLOCK_NAME_MAX)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  companyName!: string;
}
