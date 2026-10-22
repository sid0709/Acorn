import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
  forwardRef,
} from '@nestjs/common';
import { BackgroundTasksService } from '../background-tasks/background-tasks.service';
import { BACKGROUND_TASK_TYPES } from '../background-tasks/constants/task-types';
import {
  AiLabelDto,
  AiWriteDto,
  ApplierBodyDto,
  CreateLabelDto,
  PatchMessageDto,
  SaveDefinitionsDto,
  SendMailDto,
  SyncBodyDto,
} from './dto/mail-body.dto';
import {
  FolderCountsQueryDto,
  GetMessageQueryDto,
  ListThreadsQueryDto,
  MailApplierQueryDto,
  MailStatsQueryDto,
} from './dto/mail-query.dto';
import { MailService } from './mail.service';
import { MailStatsService } from './mail-stats.service';
import { formatMessageId } from './mail-ai-label.parse';

@Controller('mail')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class MailController {
  constructor(
    private readonly mail: MailService,
    private readonly mailStats: MailStatsService,
    @Optional()
    @Inject(forwardRef(() => BackgroundTasksService))
    private readonly backgroundTasks?: BackgroundTasksService,
  ) {}

  @Get('credentials')
  credentials(@Query() query: MailApplierQueryDto) {
    return this.mail.credentialsStatus(query.applierName);
  }

  @Get('threads')
  threads(@Query() query: ListThreadsQueryDto) {
    return this.mail.listThreads({
      applierName: query.applierName,
      folder: query.folder,
      label: query.label,
      search: query.search,
      unlabeled: query.unlabeled,
      page: query.page,
      pageSize: query.pageSize,
      cacheOnly: query.cacheOnly,
      force: query.force,
    });
  }

  @Get('messages/:uid')
  message(@Param('uid') uid: string, @Query() query: GetMessageQueryDto) {
    return this.mail.getMessage(query.applierName, uid, query.folder);
  }

  @Get('folder-counts')
  folderCounts(@Query() query: FolderCountsQueryDto) {
    return this.mail.folderCounts(query.applierName, query.force);
  }

  @Get('unlabeled-count')
  unlabeledCount(@Query() query: FolderCountsQueryDto) {
    return this.mail.unlabeledCount(query.applierName, query.force);
  }

  @Get('stats')
  stats(@Query() query: MailStatsQueryDto) {
    return this.mailStats.list({
      applierName: query.applierName,
      from: query.from,
      to: query.to,
      label: query.label,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Post('sync')
  @HttpCode(200)
  sync(@Body() body: ApplierBodyDto) {
    return this.mail.sync(body.applierName);
  }

  @Post('sync/initial')
  @HttpCode(200)
  syncInitial(@Body() body: SyncBodyDto) {
    return this.mail.syncInitial(
      body.applierName,
      body.folder,
      body.page,
      body.pageSize,
    );
  }

  @Post('sync/older')
  @HttpCode(200)
  syncOlder() {
    return this.mail.syncOlder();
  }

  @Post('send')
  @HttpCode(200)
  send(@Body() body: SendMailDto) {
    return this.mail.send(body.applierName, body);
  }

  @Patch('messages/:uid')
  patch(@Param('uid') uid: string, @Body() body: PatchMessageDto) {
    return this.mail.patchMessage(body.applierName, uid, body);
  }

  @Get('labels')
  labels(@Query() query: MailApplierQueryDto) {
    return this.mail.listLabels(query.applierName);
  }

  @Post('labels')
  @HttpCode(200)
  createLabel(@Body() body: CreateLabelDto) {
    return this.mail.createLabel(body.applierName, body.name, body.parentId);
  }

  @Delete('labels/:labelId')
  deleteLabel(
    @Param('labelId') labelId: string,
    @Query() query: MailApplierQueryDto,
    @Body() body: ApplierBodyDto,
  ) {
    const applierName = query.applierName || body.applierName;
    return this.mail.deleteLabel(applierName, decodeURIComponent(labelId));
  }

  @Put('labels')
  legacyPutLabels() {
    return {
      success: false,
      error: 'Use POST /mail/labels to create a label',
    };
  }

  @Get('label-definitions')
  getDefinitions(@Query() query: MailApplierQueryDto) {
    return this.mail.getDefinitions(query.applierName);
  }

  @Put('label-definitions')
  saveDefinitions(@Body() body: SaveDefinitionsDto) {
    return this.mail.saveDefinitions(body.applierName, body.definitions || {});
  }

  @Post('ai-write')
  @HttpCode(200)
  aiWrite(@Body() body: AiWriteDto) {
    return this.mail.aiWrite(body.applierName, body);
  }

  /** Legacy enqueue — prefers BackgroundTasksService when available. */
  @Post('ai-label')
  @HttpCode(202)
  async aiLabel(@Body() body: AiLabelDto) {
    if (body.labelDefinitions) {
      await this.mail.saveDefinitions(body.applierName, body.labelDefinitions);
    }
    const messageIds = (body.messages || []).map((m) =>
      m.mailbox ? formatMessageId(m.mailbox, m.uid) : String(m.uid),
    );
    if (!this.backgroundTasks) {
      return {
        success: false,
        error: 'Background tasks module unavailable',
      };
    }
    return this.backgroundTasks.create({
      type: BACKGROUND_TASK_TYPES.MAIL_AI_LABEL,
      applierName: body.applierName,
      payload: { messageIds },
    });
  }
}
