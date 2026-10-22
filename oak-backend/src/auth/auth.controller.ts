import {
  Body,
  Controller,
  HttpException,
  HttpCode,
  Post,
  Req,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AccountRenameService } from './account-rename.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeUsernameDto } from './dto/change-username.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import {
  beginAccountDeleteSse,
  writeAccountDeleteSse,
} from './lib/account-delete-sse';
import { SignInDto } from './dto/signin.dto';
import { SignUpDto } from './dto/signup.dto';
import { VendorPasswordDto } from './dto/vendor-password.dto';

@Controller('auth')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountRename: AccountRenameService,
  ) {}

  @Post('signin')
  @HttpCode(200)
  signin(@Body() dto: SignInDto) {
    return this.authService.signin(dto);
  }

  @Post('signup')
  @HttpCode(201)
  signup(@Body() dto: SignUpDto) {
    return this.authService.signup(dto);
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(@Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(dto);
  }

  @Post('change-username')
  @HttpCode(200)
  changeUsername(@Body() dto: ChangeUsernameDto) {
    return this.accountRename.rename(dto);
  }

  @Post('delete-account')
  @HttpCode(200)
  deleteAccount(@Body() dto: DeleteAccountDto) {
    return this.authService.deleteAccount(dto);
  }

  /** SSE progress stream for Settings → Delete account UI. */
  @Post('delete-account/stream')
  async deleteAccountStream(
    @Body() dto: DeleteAccountDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    beginAccountDeleteSse(res);
    const onClose = () => {
      /* client gone — cascade still finishes server-side */
    };
    req.once('close', onClose);

    try {
      const result = await this.authService.deleteAccountWithProgress(
        dto,
        (progress) => {
          writeAccountDeleteSse(res, 'progress', progress);
        },
      );
      writeAccountDeleteSse(res, 'done', {
        success: true,
        message: result.message,
      });
    } catch (err) {
      const message = extractHttpMessage(err);
      const status = err instanceof HttpException ? err.getStatus() : 500;
      writeAccountDeleteSse(res, 'error', {
        success: false,
        message,
        status,
        error: message,
      });
    } finally {
      req.off('close', onClose);
      if (!res.writableEnded) res.end();
    }
  }

  @Post('vendor-password')
  @HttpCode(200)
  setVendorPassword(@Body() dto: VendorPasswordDto) {
    return this.authService.setVendorPassword(dto);
  }
}

function extractHttpMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    if (typeof body === 'string') return body;
    if (body && typeof body === 'object') {
      const rec = body as { message?: unknown };
      if (typeof rec.message === 'string') return rec.message;
      if (Array.isArray(rec.message)) return rec.message.map(String).join('; ');
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Could not delete account';
}
