import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ApplierBodyDto {
  @IsString()
  applierName!: string;
}

export class SyncBodyDto extends ApplierBodyDto {
  @IsOptional()
  @IsString()
  folder?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  batchSize?: number;
}

export class SendMailDto extends ApplierBodyDto {
  @IsString()
  to!: string;

  @IsString()
  subject!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsString()
  replyToUid?: string;

  @IsOptional()
  @IsString()
  sourceFolder?: string;
}

export class PatchMessageDto extends ApplierBodyDto {
  @IsOptional()
  @IsBoolean()
  seen?: boolean;

  @IsOptional()
  @IsBoolean()
  flagged?: boolean;

  @IsOptional()
  @IsString()
  folder?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addLabels?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  removeLabels?: string[];

  @IsOptional()
  @IsString()
  sourceFolder?: string;
}

export class CreateLabelDto extends ApplierBodyDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

export class SaveDefinitionsDto extends ApplierBodyDto {
  @Allow()
  definitions!: Record<string, string>;
}

export class AiWriteDto extends ApplierBodyDto {
  @IsIn(['write', 'fine-tune', 'reply'])
  mode!: 'write' | 'fine-tune' | 'reply';

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  replyContext?: string;
}

export class AiLabelMessageDto {
  @Type(() => Number)
  @IsInt()
  uid!: number;

  @IsOptional()
  @IsString()
  mailbox?: string;
}

export class AiLabelDto extends ApplierBodyDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiLabelMessageDto)
  messages!: AiLabelMessageDto[];

  @IsOptional()
  @Allow()
  labelDefinitions?: Record<string, string>;
}
