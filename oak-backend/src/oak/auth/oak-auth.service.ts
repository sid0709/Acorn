import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { OakSessionService } from './oak-session.service';
import type { OakSignInDto } from './dto/signin.dto';

@Injectable()
export class OakAuthService {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: OakSessionService,
  ) {}

  async signIn(dto: OakSignInDto) {
    const result = await this.auth.signin(dto);
    if (!result?.success || !result.user?._id) {
      throw new UnauthorizedException({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }

    const created = await this.sessions.create({
      accountId: result.user._id,
      profileId: result.user._id,
      applierName: result.user.name,
      username: result.user.name,
    });

    return {
      success: true as const,
      session: {
        username: created.session.username,
        displayName: result.user.name,
        profileId: created.session.profileId,
        authenticatedAt: created.session.authenticatedAt,
        expiresAt: created.session.expiresAt,
        accessToken: created.token,
      },
    };
  }

  async signOut(token: string) {
    await this.sessions.revoke(token);
    return { success: true as const };
  }
}
