import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { FirebaseAdminService } from './firebase-admin.service';
import { FirebaseExplorerController } from './firebase-explorer.controller';
import { FirebaseExplorerService } from './firebase-explorer.service';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [FirebaseExplorerController],
  providers: [FirebaseAdminService, FirebaseExplorerService, AdminGuard],
  exports: [FirebaseAdminService],
})
export class FirebaseModule {}
