import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BackgroundTasksService } from './background-tasks.service';

class CreateTaskDto {
  @IsOptional()
  @IsString()
  requestId?: string;

  @IsString()
  type!: string;

  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsString()
  applierName?: string;

  @Allow()
  payload?: Record<string, unknown>;
}

class ListTasksQueryDto {
  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === '1' || value === 'true')
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@Controller('background-tasks')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class BackgroundTasksController {
  constructor(private readonly tasks: BackgroundTasksService) {}

  @Post()
  @HttpCode(202)
  create(@Body() body: CreateTaskDto) {
    return this.tasks.create(body);
  }

  @Get()
  list(@Query() query: ListTasksQueryDto) {
    return this.tasks.list({
      profileId: query.profileId,
      active: query.active,
      limit: query.limit,
    });
  }

  @Get(':taskId')
  get(@Param('taskId') taskId: string) {
    return this.tasks.get(taskId);
  }

  @Post(':taskId/cancel')
  @HttpCode(200)
  cancel(@Param('taskId') taskId: string) {
    return this.tasks.cancel(taskId);
  }
}
