import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountInfoService } from '../../auth/account-info.service';
import {
  ADMIN_APPLIER_HEADER,
  isAdminPermission,
} from '../constants/admin.constants';

/**
 * Legacy Athens admin gate: require x-applier-name with permission "admin".
 * (No Firebase ID-token middleware on athens-backend yet.)
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly accounts: AccountInfoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const requester = String(req.headers[ADMIN_APPLIER_HEADER] ?? '').trim();
    if (!requester) {
      throw new UnauthorizedException('Admin authentication required');
    }

    const account = await this.accounts.findByName(requester);
    if (!account || !isAdminPermission(account.permission)) {
      throw new ForbiddenException('Admin permission required');
    }

    return true;
  }
}
