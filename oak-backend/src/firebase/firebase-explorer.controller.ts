import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { GetDocumentQueryDto } from './dto/get-document.query.dto';
import { ListCollectionsQueryDto } from './dto/list-collections.query.dto';
import { ListDocumentsQueryDto } from './dto/list-documents.query.dto';
import { ListStorageQueryDto } from './dto/list-storage.query.dto';
import { SearchDocumentsDto } from './dto/search-documents.dto';
import { StorageUrlQueryDto } from './dto/storage-url.query.dto';
import { FirebaseExplorerService } from './firebase-explorer.service';

function ok<T extends Record<string, unknown>>(data: T) {
  return { success: true as const, ...data };
}

function mapExplorerError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'File not found' || message === 'Document not found') {
    throw new NotFoundException(message);
  }
  throw new BadRequestException(message);
}

@Controller('firebase')
@UseGuards(AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class FirebaseExplorerController {
  constructor(private readonly explorer: FirebaseExplorerService) {}

  @Get('status')
  async status() {
    const status = await this.explorer.fetchStatus();
    return ok({ status });
  }

  @Get('collections')
  async collections(@Query() query: ListCollectionsQueryDto) {
    try {
      const data = await this.explorer.listCollections(query.parent ?? '');
      return ok(data);
    } catch (err) {
      mapExplorerError(err);
    }
  }

  @Get('documents')
  async documents(@Query() query: ListDocumentsQueryDto) {
    try {
      const data = await this.explorer.listDocuments({
        path: query.path,
        limit: query.limit,
        cursor: query.cursor,
        orderField: query.orderField,
      });
      return ok(data);
    } catch (err) {
      mapExplorerError(err);
    }
  }

  @Get('document')
  async document(@Query() query: GetDocumentQueryDto) {
    try {
      const data = await this.explorer.getDocument(query.path);
      if (!data.exists) {
        throw new NotFoundException('Document not found');
      }
      return ok(data);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapExplorerError(err);
    }
  }

  @Get('storage')
  async storage(@Query() query: ListStorageQueryDto) {
    try {
      const data = await this.explorer.listStorage({
        prefix: query.prefix,
        pageToken: query.pageToken,
        maxResults: query.limit,
      });
      return ok(data);
    } catch (err) {
      mapExplorerError(err);
    }
  }

  @Get('storage/url')
  async storageUrl(@Query() query: StorageUrlQueryDto) {
    try {
      const data = await this.explorer.getSignedStorageUrl(query.path);
      return ok(data);
    } catch (err) {
      mapExplorerError(err);
    }
  }

  @Post('search')
  @HttpCode(200)
  async search(@Body() body: SearchDocumentsDto) {
    try {
      const data = await this.explorer.searchDocuments({
        path: body.path,
        field: body.field,
        op: body.op,
        value: body.value,
        limit: body.limit,
      });
      return ok(data);
    } catch (err) {
      mapExplorerError(err);
    }
  }
}
