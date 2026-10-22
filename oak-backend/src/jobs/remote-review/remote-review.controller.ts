import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ListRemoteReviewQueryDto } from './dto/list-remote-review.query.dto';
import { ResolveRemoteReviewDto } from './dto/resolve-remote-review.dto';
import { RemoteReviewService } from './remote-review.service';

@Controller('jobs/remote-review')
export class RemoteReviewController {
  constructor(private readonly reviews: RemoteReviewService) {}

  @Get()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  list(@Query() query: ListRemoteReviewQueryDto) {
    return this.reviews.list(query.limit);
  }

  @Post('resolve')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  resolve(@Body() body: ResolveRemoteReviewDto) {
    return this.reviews.resolve(body);
  }
}
