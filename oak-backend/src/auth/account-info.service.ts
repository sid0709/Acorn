import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AccountInfo } from '@prisma/client';
import { AccountInfoRepository } from './account-info.repository';
import { AuthMessages } from './constants/auth.constants';
import {
  USER_STATUS,
  isApprovedUserStatus,
} from './constants/user-status.constants';

@Injectable()
export class AccountInfoService {
  constructor(private readonly accounts: AccountInfoRepository) {}

  usernameKey(name: string): string {
    return name.trim().toLocaleLowerCase('en-US');
  }

  /** Exact name first (signin contract), then usernameKey fallback. */
  async findByName(
    name: string,
    { exactFirst = false } = {},
  ): Promise<AccountInfo | null> {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return null;

    const exact = await this.accounts.findByExactName(trimmed);
    if (exact || exactFirst) return exact;

    return this.accounts.findByUsernameKey(this.usernameKey(trimmed));
  }

  list(): Promise<AccountInfo[]> {
    return this.accounts.listOrderedByName();
  }

  listPending(): Promise<AccountInfo[]> {
    return this.accounts.listByUserStatus(USER_STATUS.pending);
  }

  create(data: {
    name: string;
    usernameKey: string;
    password: string;
    userStatus?: string;
  }): Promise<AccountInfo> {
    return this.accounts.create(data);
  }

  updatePassword(id: string, password: string): Promise<void> {
    return this.accounts.updatePassword(id, password);
  }

  updateVendorPassword(
    id: string,
    vendorPassword: string | null,
  ): Promise<void> {
    return this.accounts.updateVendorPassword(id, vendorPassword);
  }

  updateName(id: string, name: string, usernameKey: string): Promise<void> {
    return this.accounts.updateName(id, name, usernameKey);
  }

  async approveByName(name: string): Promise<void> {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException(AuthMessages.nameRequired);
    }
    const user = await this.findByName(trimmed, { exactFirst: true });
    if (!user) {
      throw new NotFoundException(AuthMessages.accountNotFound);
    }
    if (isApprovedUserStatus(user.userStatus)) return;
    await this.accounts.updateUserStatus(user.id, USER_STATUS.approved);
  }
}
