import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class UploadResumeDto {
  @IsString()
  ownerName!: string;

  @IsString()
  ownerId!: string;

  @IsString()
  techStack!: string;

  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;

  @IsString()
  contentBase64!: string;
}

export class BulkUploadResumeItemDto {
  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsString()
  techStack!: string;

  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;

  @IsString()
  contentBase64!: string;
}

export class BulkUploadResumesDto {
  @IsString()
  ownerName!: string;

  @IsString()
  ownerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkUploadResumeItemDto)
  items!: BulkUploadResumeItemDto[];
}

export class OwnerNameDto {
  @IsString()
  ownerName!: string;
}

export class ListResumesQueryDto {
  @IsString()
  ownerName!: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  profileId?: string;
}

export class StartResumeAnalyzeDto {
  @IsOptional()
  @IsString()
  applierName?: string;

  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsOptional()
  @IsString()
  profileId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  resumeIds!: string[];

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
