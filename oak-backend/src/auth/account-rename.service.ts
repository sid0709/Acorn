import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AccountInfoRepository } from './account-info.repository';
import { AccountInfoService } from './account-info.service';
import { AccountRenameMongoService } from './account-rename-mongo.service';
import { AccountRenamePathsService } from './account-rename-paths.service';
import {
  AccountStorageRenameService,
  storageRenamePlan,
} from './account-storage-rename.service';
import { AuthMessages } from './constants/auth.constants';
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  USERNAME_PATTERN,
} from './constants/username.constants';
import { toAuthUser, type AuthUserView } from './mappers/account.mapper';
import { PasswordService } from './password.service';

@Injectable()
export class AccountRenameService {
  private readonly logger = new Logger(AccountRenameService.name);

  constructor(
    private readonly accounts: AccountInfoService,
    private readonly accountRows: AccountInfoRepository,
    private readonly passwords: PasswordService,
    private readonly mongo: AccountRenameMongoService,
    private readonly paths: AccountRenamePathsService,
    private readonly storage: AccountStorageRenameService,
  ) {}

  async rename(input: {
    name: string;
    newName: string;
    currentPassword: string;
  }): Promise<{ success: true; user: AuthUserView; message: string }> {
    const currentName = String(input.name || '').trim();
    const nextName = String(input.newName || '').trim();
    const currentPassword = String(input.currentPassword || '');

    if (!currentName || !nextName || !currentPassword) {
      throw new BadRequestException(AuthMessages.changeUsernameRequired);
    }
    this.assertUsername(nextName);

    const user = await this.accounts.findByName(currentName, {
      exactFirst: true,
    });
    if (!user) {
      throw new NotFoundException(AuthMessages.accountNotFound);
    }
    const valid = await this.passwords.verify(user.password, currentPassword);
    if (!valid) {
      throw new UnauthorizedException(AuthMessages.currentPasswordIncorrect);
    }

    if (nextName === user.name) {
      return {
        success: true,
        user: toAuthUser(user),
        message: AuthMessages.usernameUnchanged,
      };
    }

    await this.assertAvailable(nextName, user.id);
    const plan = storageRenamePlan(user.name, nextName, user.id);
    let storageMoved = false;
    try {
      await this.storage.copyPrefixes(plan);
      storageMoved = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Storage copy skipped during username rename: ${message}`,
      );
    }
    await this.accountRows.updateName(
      user.id,
      nextName,
      this.accounts.usernameKey(nextName),
    );
    await this.mongo.retargetApplierName(user.name, nextName);
    if (storageMoved) {
      await this.paths.rewriteStoragePrefix(plan.resumeFrom, plan.resumeTo);
      await this.paths.rewriteStoragePrefix(
        plan.recordingFrom,
        plan.recordingTo,
      );
      await this.paths.rewriteVendorRecordingPrefix(
        nextName,
        plan.recordingFrom,
        plan.recordingTo,
      );
      await this.storage.deletePrefixes(plan);
    }

    const updated = await this.accounts.findByName(nextName, {
      exactFirst: true,
    });
    return {
      success: true,
      user: toAuthUser(updated ?? { ...user, name: nextName }),
      message: AuthMessages.usernameUpdated,
    };
  }

  private assertUsername(name: string): void {
    if (
      name.length < MIN_USERNAME_LENGTH ||
      name.length > MAX_USERNAME_LENGTH ||
      !USERNAME_PATTERN.test(name)
    ) {
      throw new BadRequestException(AuthMessages.usernameInvalid);
    }
  }

  private async assertAvailable(
    newName: string,
    selfId: string,
  ): Promise<void> {
    const exact = await this.accountRows.findByExactName(newName);
    if (exact && exact.id !== selfId) {
      throw new ConflictException(AuthMessages.userExists);
    }
    const keyed = await this.accountRows.findByUsernameKey(
      this.accounts.usernameKey(newName),
    );
    if (keyed && keyed.id !== selfId) {
      throw new ConflictException(AuthMessages.userExists);
    }
  }
}
