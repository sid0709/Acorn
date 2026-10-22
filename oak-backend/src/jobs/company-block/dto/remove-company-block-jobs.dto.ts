import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { COMPANY_BLOCK_SEARCH_LIMIT } from '../constants/company-block.constants';

export class RemoveCompanyBlockJobsDto {
  @IsArray()
  @ArrayMaxSize(COMPANY_BLOCK_SEARCH_LIMIT)
  @IsString({ each: true })
  ids!: string[];
}
