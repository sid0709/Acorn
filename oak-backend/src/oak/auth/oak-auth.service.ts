import { Injectable } from '@nestjs/common';
import { AcornAuthClient } from '../../acorn/acorn-auth-client.service';
import type { OakSignInDto } from './dto/signin.dto';
import { OakSessionService } from './oak-session.service';

@Injectable()
export class OakAuthService {
  constructor(
    private readonly acorn: AcornAuthClient,
    private readonly sessions: OakSessionService,
  ) {}

  async signIn(dto: OakSignInDto) {
    const { token, session } = await this.acorn.signIn(dto.email, dto.password);
    const stored = await this.sessions.read(token);
    return {
      success: true as const,
      session: {
        username: session.username,
        displayName: session.displayName,
        profileId: session.profileId,
        authenticatedAt: stored?.authenticatedAt ?? new Date().toISOString(),
        expiresAt: stored?.expiresAt ?? '',
        accessToken: token,
      },
    };
  }

  async signOut(token: string) {
    await this.sessions.revoke(token);
    return { success: true as const };
  }
}
