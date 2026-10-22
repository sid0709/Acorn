import { Module, forwardRef } from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { FirebaseModule } from '../firebase/firebase.module';
import { AccountCascadeDeleteService } from './account-cascade-delete.service';
import { AccountDataPurgeService } from './account-data-purge.service';
import { AccountInfoController } from './account-info.controller';
import { AccountInfoRepository } from './account-info.repository';
import { AccountInfoService } from './account-info.service';
import { AccountRenameMongoService } from './account-rename-mongo.service';
import { AccountRenamePathsService } from './account-rename-paths.service';
import { AccountRenameService } from './account-rename.service';
import { AccountStorageCleanupService } from './account-storage-cleanup.service';
import { AccountStorageRenameService } from './account-storage-rename.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { UserApprovalController } from './user-approval.controller';

@Module({
  imports: [forwardRef(() => FirebaseModule)],
  controllers: [AuthController, AccountInfoController, UserApprovalController],
  providers: [
    AuthService,
    AccountInfoService,
    AccountInfoRepository,
    PasswordService,
    AdminGuard,
    AccountRenameMongoService,
    AccountRenamePathsService,
    AccountStorageRenameService,
    AccountRenameService,
    AccountCascadeDeleteService,
    AccountDataPurgeService,
    AccountStorageCleanupService,
  ],
  exports: [
    AuthService,
    AccountInfoService,
    AccountInfoRepository,
    PasswordService,
    AdminGuard,
  ],
})
export class AuthModule {}
