import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  OakSessionService,
  type OakPublicSession,
} from './oak-session.service';

export type OakAuthedRequest = Request & {
  oakSession?: OakPublicSession;
  oakToken?: string;
};

@Injectable()
export class OakAuthGuard implements CanActivate {
  constructor(private readonly sessions: OakSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OakAuthedRequest>();
    const header = String(req.headers.authorization || '');
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match?.[1]?.trim() || '';
    if (!token) {
      throw new UnauthorizedException({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Oak session required',
      });
    }
    const session = await this.sessions.read(token);
    if (!session) {
      throw new UnauthorizedException({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Oak session expired or invalid',
      });
    }
    req.oakSession = session;
    req.oakToken = token;
    return true;
  }
}
