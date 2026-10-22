import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { AccountInfoService } from './account-info.service';
import { AuthMessages } from './constants/auth.constants';
import { sanitizeAccount } from './mappers/account.mapper';

@Controller('account_info')
export class AccountInfoController {
  constructor(private readonly accounts: AccountInfoService) {}

  @Get()
  async list() {
    const rows = await this.accounts.list();
    return rows.map(sanitizeAccount);
  }

  @Get('by/:name')
  async byName(@Param('name') raw: string) {
    const name = decodeURIComponent(String(raw ?? '')).trim();
    if (!name) {
      throw new BadRequestException(AuthMessages.nameRequired);
    }
    const doc = await this.accounts.findByName(name);
    if (!doc) {
      throw new NotFoundException(AuthMessages.accountNotFound);
    }
    return { success: true, data: sanitizeAccount(doc) };
  }
}
