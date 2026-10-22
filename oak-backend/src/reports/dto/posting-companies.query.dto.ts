import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  POSTING_COMPANIES_MAX_PAGE_SIZE,
  POSTING_COMPANY_SORTS,
} from '../constants/posting-companies.constants';
import { ReportsRangeQueryDto } from './reports-range.query.dto';

export class PostingCompaniesQueryDto extends ReportsRangeQueryDto {
  @IsOptional()
  @IsIn(POSTING_COMPANY_SORTS)
  @Transform(({ value }) => {
    const raw = typeof value === 'string' ? value.trim() : '';
    return raw || undefined;
  })
  sort?: (typeof POSTING_COMPANY_SORTS)[number];

  @IsOptional()
  @IsString()
  @Transform(({ value }) => {
    const raw = typeof value === 'string' ? value.trim() : '';
    return raw || undefined;
  })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTING_COMPANIES_MAX_PAGE_SIZE)
  limit?: number;
}
