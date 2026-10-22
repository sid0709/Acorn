import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import { LensAuthGuard, type LensAuthedRequest } from './lens-auth.guard';
import { LensAuthService } from './lens-auth.service';

class SignInDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

@Controller('athens-lens/auth')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AthensLensAuthController {
  constructor(private readonly auth: LensAuthService) {}

  @Post('signin')
  signIn(@Body() body: SignInDto) {
    return this.auth.signIn(body.username, body.password);
  }

  @Post('signout')
  @UseGuards(LensAuthGuard)
  signOut(@Req() req: LensAuthedRequest) {
    return this.auth.signOut(req.athensLensToken || '');
  }
}
