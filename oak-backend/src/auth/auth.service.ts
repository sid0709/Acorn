import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type AccountInfo } from '@prisma/client';
import { AccountCascadeDeleteService } from './account-cascade-delete.service';
import { AccountInfoService } from './account-info.service';
import {
  AuthMessages,
  MIN_NEW_PASSWORD_LENGTH,
} from './constants/auth.constants';
import {
  USER_STATUS,
  isApprovedUserStatus,
} from './constants/user-status.constants';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import type { AccountDeleteProgressFn } from './lib/account-delete-progress';
import { SignInDto } from './dto/signin.dto';
import { SignUpDto } from './dto/signup.dto';
import { VendorPasswordDto } from './dto/vendor-password.dto';
import { toAuthUser } from './mappers/account.mapper';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly accounts: AccountInfoService,
    private readonly passwords: PasswordService,
    private readonly cascadeDelete: AccountCascadeDeleteService,
  ) {}

  async signin(dto: SignInDto) {
    const name = String(dto.name ?? '').trim();
    const password = String(dto.password ?? '');
    if (!name || !password) {
      throw new BadRequestException(AuthMessages.namePasswordRequired);
    }

    const user = await this.accounts.findByName(name, { exactFirst: true });
    if (!user) {
      throw new UnauthorizedException(AuthMessages.invalidCredentials);
    }

    const valid = await this.passwords.verify(user.password, password);
    if (!valid) {
      throw new UnauthorizedException(AuthMessages.invalidCredentials);
    }

    if (!isApprovedUserStatus(user.userStatus)) {
      throw new ForbiddenException(AuthMessages.accountPendingApproval);
    }

    return {
      success: true,
      user: toAuthUser(user),
      message: AuthMessages.signedIn,
    };
  }

  async signup(dto: SignUpDto) {
    const name = String(dto.name ?? '').trim();
    const password = String(dto.password ?? '');
    if (!name || !password) {
      throw new BadRequestException(AuthMessages.namePasswordRequired);
    }

    const existing = await this.accounts.findByName(name);
    if (existing) {
      throw new ConflictException(AuthMessages.userExists);
    }

    const hashedPassword = await this.passwords.hash(password);
    try {
      const created = await this.accounts.create({
        name,
        usernameKey: this.accounts.usernameKey(name),
        password: hashedPassword,
        userStatus: USER_STATUS.pending,
      });
      return {
        success: true,
        pending: true,
        user: toAuthUser(created),
        message: AuthMessages.userCreatedPending,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(AuthMessages.userExists);
      }
      throw error;
    }
  }

  async changePassword(dto: ChangePasswordDto) {
    const name = String(dto.name ?? '').trim();
    const currentPassword = String(dto.currentPassword ?? '');
    const newPassword = String(dto.newPassword ?? '');

    if (!name || !currentPassword || !newPassword) {
      throw new BadRequestException(AuthMessages.changePasswordRequired);
    }
    if (newPassword.length < MIN_NEW_PASSWORD_LENGTH) {
      throw new BadRequestException(AuthMessages.newPasswordTooShort);
    }

    const user = await this.accounts.findByName(name);
    if (!user) {
      throw new NotFoundException(AuthMessages.accountNotFound);
    }

    const valid = await this.passwords.verify(user.password, currentPassword);
    if (!valid) {
      throw new UnauthorizedException(AuthMessages.currentPasswordIncorrect);
    }

    const hashedPassword = await this.passwords.hash(newPassword);
    await this.accounts.updatePassword(user.id, hashedPassword);

    return { success: true, message: AuthMessages.passwordUpdated };
  }

  async deleteAccount(dto: DeleteAccountDto) {
    const user = await this.verifyDeleteAccount(dto);
    await this.cascadeDelete.deleteAccount(user);
    return { success: true, message: AuthMessages.accountDeleted };
  }

  async deleteAccountWithProgress(
    dto: DeleteAccountDto,
    onProgress: AccountDeleteProgressFn,
  ): Promise<{ success: true; message: string }> {
    await onProgress({
      phase: 'verifying',
      message: 'Verifying password…',
      removed: 0,
      total: 0,
      percent: 0,
    });
    const user = await this.verifyDeleteAccount(dto);
    await this.cascadeDelete.deleteAccount(user, onProgress);
    return { success: true, message: AuthMessages.accountDeleted };
  }

  private async verifyDeleteAccount(
    dto: DeleteAccountDto,
  ): Promise<AccountInfo> {
    const name = String(dto.name ?? '').trim();
    const password = String(dto.password ?? '');
    const confirmName = String(dto.confirmName ?? '').trim();

    if (!name || !password || !confirmName) {
      throw new BadRequestException(AuthMessages.deleteAccountRequired);
    }
    if (confirmName !== name) {
      throw new BadRequestException(AuthMessages.confirmNameMismatch);
    }

    const user = await this.accounts.findByName(name, { exactFirst: true });
    if (!user) {
      throw new NotFoundException(AuthMessages.accountNotFound);
    }

    const valid = await this.passwords.verify(user.password, password);
    if (!valid) {
      throw new UnauthorizedException(AuthMessages.passwordIncorrect);
    }
    return user;
  }

  async setVendorPassword(dto: VendorPasswordDto) {
    const name = String(dto.applierName ?? '').trim();
    if (!name) {
      throw new BadRequestException(AuthMessages.nameRequired);
    }

    const user = await this.accounts.findByName(name);
    if (!user) {
      throw new NotFoundException(AuthMessages.accountNotFound);
    }

    if (dto.clear === true) {
      await this.accounts.updateVendorPassword(user.id, null);
      return { success: true, message: AuthMessages.vendorPasswordCleared };
    }

    const vendorPassword = String(dto.vendorPassword ?? '');
    if (vendorPassword.length < MIN_NEW_PASSWORD_LENGTH) {
      throw new BadRequestException(AuthMessages.vendorPasswordRequired);
    }

    const hashed = await this.passwords.hash(vendorPassword);
    await this.accounts.updateVendorPassword(user.id, hashed);
    return { success: true, message: AuthMessages.vendorPasswordUpdated };
  }
}
