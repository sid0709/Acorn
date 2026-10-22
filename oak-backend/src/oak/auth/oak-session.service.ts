import { Injectable } from '@nestjs/common';
import { AcornAuthClient } from '../../acorn/acorn-auth-client.service';
import { AcornSessionService } from '../../acorn/acorn-session.service';

export type OakPublicSession = {
  accountId: string;
  profileId: string;
  applierName: string;
  username: string;
  authenticatedAt: string;
  expiresAt: string;
};

/** An Oak session is an Acorn session: same token, same `acorn_sessions` row. */
@Injectable()
export class OakSessionService {
  constructor(
    private readonly sessions: AcornSessionService,
    private readonly acorn: AcornAuthClient,
  ) {}

  async read(token: string): Promise<OakPublicSession | null> {
    const session = await this.sessions.read(token);
    if (!session) return null;
    return {
      accountId: session.accountId,
      profileId: session.accountId,
      applierName: session.name,
      username: session.email,
      authenticatedAt: session.authenticatedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async revoke(token: string): Promise<void> {
    await this.acorn.signOut(String(token || '').trim());
  }
}
