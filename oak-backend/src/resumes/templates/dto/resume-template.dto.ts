import { IsObject, IsOptional, IsString } from 'class-validator';

export class UploadResumeTemplateDto {
  @IsString()
  ownerName!: string;

  @IsString()
  fileName!: string;

  @IsString()
  contentBase64!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  identity?: { careers?: Array<{ company?: string }> };
}

export class ListResumeTemplatesQueryDto {
  @IsString()
  ownerName!: string;
}

export class FillResumeTemplateDto {
  @IsString()
  templateId!: string;

  @IsString()
  ownerName!: string;

  @IsOptional()
  @IsObject()
  sections?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  fileName?: string;
}
