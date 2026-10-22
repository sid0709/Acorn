import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ACORN_ACCOUNTS_COLLECTION,
  ACORN_SESSIONS_COLLECTION,
  ACORN_SESSION_CACHE_MS,
} from './acorn.constants';
import { AcornDbService } from './acorn-db.service';

/** A live Acorn sign-in, resolved from a bearer token. */
export type AcornSession = {
  accountId: string;
  name: string;
  email: string;
  authenticatedAt: Date;
  expiresAt: Date;
};

type StoredSession = {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
};

type StoredAccount = {
  id: string;
  name: string;
  email: string;
  deactivatedAt?: Date;
};

export function acornTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Reads `acorn_sessions` the way acorn-backend's `account.Store.Session` does:
 * SHA-256 of the token, unexpired, account present and not deactivated.
 */
@Injectable()
export class AcornSessionService {
  private readonly checked = new Map<
    string,
    { session: AcornSession; at: number }
  >();

  constructor(private readonly db: AcornDbService) {}

  async read(token: string): Promise<AcornSession | null> {
    const normalized = String(token || '').trim();
    if (!normalized) return null;
    const hash = acornTokenHash(normalized);
    const now = Date.now();
    const cached = this.checked.get(hash);
    if (
      cached &&
      now - cached.at < ACORN_SESSION_CACHE_MS &&
      cached.session.expiresAt.getTime() > now
    ) {
      return cached.session;
    }
    this.checked.delete(hash);

    const sessions = await this.db.collection<StoredSession>(
      ACORN_SESSIONS_COLLECTION,
    );
    const row = await sessions.findOne({ tokenHash: hash });
    if (!row || row.expiresAt.getTime() <= now) return null;

    const accounts = await this.db.collection<StoredAccount>(
      ACORN_ACCOUNTS_COLLECTION,
    );
    const account = await accounts.findOne({ id: row.userId });
    if (!account || account.deactivatedAt) return null;

    const session: AcornSession = {
      accountId: account.id,
      name: account.name,
      email: account.email,
      authenticatedAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
    this.checked.set(hash, { session, at: now });
    return session;
  }

  forget(token: string): void {
    this.checked.delete(acornTokenHash(String(token || '').trim()));
  }
}
