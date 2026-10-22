import { Injectable } from '@nestjs/common';
import { AccountInfoService } from '../../auth/account-info.service';
import { isAdminPermission } from '../../common/constants/admin.constants';

@Injectable()
export class OakAdminPrivilegesService {
  constructor(private readonly accounts: AccountInfoService) {}

  async isAdmin(applierName: string): Promise<boolean> {
    const account = await this.accounts.findByName(applierName);
    return isAdminPermission(account?.permission);
  }
}
