import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  LensSessionService,
  type LensPublicSession,
} from './lens-session.service';

export type LensAuthedRequest = Request & {
  athensLensSession?: LensPublicSession;
  athensLensToken?: string;
};

@Injectable()
export class LensAuthGuard implements CanActivate {
  constructor(private readonly sessions: LensSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<LensAuthedRequest>();
    const header = String(req.headers.authorization || '');
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match?.[1]?.trim() || '';
    if (!token) {
      throw new UnauthorizedException({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Athens Lens session required',
      });
    }
    const session = await this.sessions.read(token);
    if (!session) {
      throw new UnauthorizedException({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Athens Lens session expired or invalid',
      });
    }
    req.athensLensSession = session;
    req.athensLensToken = token;
    return true;
  }
}
