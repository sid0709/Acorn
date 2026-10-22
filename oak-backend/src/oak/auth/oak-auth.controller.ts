import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { OakAuthGuard, type OakAuthedRequest } from './oak-auth.guard';
import { OakAuthService } from './oak-auth.service';
import { OakSignInDto } from './dto/signin.dto';

@Controller('oak/auth')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class OakAuthController {
  constructor(private readonly auth: OakAuthService) {}

  @Post('signin')
  signIn(@Body() dto: OakSignInDto) {
    return this.auth.signIn(dto);
  }

  @Post('signout')
  @UseGuards(OakAuthGuard)
  signOut(@Req() req: OakAuthedRequest) {
    return this.auth.signOut(req.oakToken || '');
  }

  @Get('me')
  @UseGuards(OakAuthGuard)
  me(@Req() req: OakAuthedRequest) {
    return {
      success: true as const,
      session: req.oakSession,
    };
  }
}
