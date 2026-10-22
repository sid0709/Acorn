import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { AccountInfoService } from './account-info.service';
import { AuthMessages } from './constants/auth.constants';
import { ApproveUserDto } from './dto/approve-user.dto';

@Controller('auth')
@UseGuards(AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class UserApprovalController {
  constructor(private readonly accounts: AccountInfoService) {}

  @Get('pending-users')
  async pendingUsers() {
    const rows = await this.accounts.listPending();
    return {
      users: rows.map((account) => ({ name: account.name })),
    };
  }

  @Post('approve-user')
  @HttpCode(200)
  async approveUser(@Body() dto: ApproveUserDto) {
    await this.accounts.approveByName(dto.name);
    return { success: true, message: AuthMessages.userApproved };
  }
}
