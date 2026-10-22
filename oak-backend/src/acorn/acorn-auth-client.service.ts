import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  ACORN_API_TIMEOUT_MS,
  ACORN_SIGNIN_PATH,
  ACORN_SIGNOUT_PATH,
  acornApiUrl,
} from './acorn.constants';
import { AcornSessionService } from './acorn-session.service';

export type AcornSignInResult = {
  token: string;
  session: {
    accountId: string;
    profileId: string;
    applierName: string;
    username: string;
    displayName: string;
    email: string;
  };
};

/**
 * Sign-in and sign-out go through acorn-backend so the password check, the
 * session row and its cache stay in one place. Oak only reads the result.
 */
@Injectable()
export class AcornAuthClient {
  constructor(private readonly sessions: AcornSessionService) {}

  async signIn(email: string, password: string): Promise<AcornSignInResult> {
    const res = await this.post(ACORN_SIGNIN_PATH, { email, password });
    const body = (await res.json().catch(() => ({}))) as {
      token?: string;
      session?: AcornSignInResult['session'];
      error?: string;
    };
    if (!res.ok || !body.token || !body.session) {
      throw new UnauthorizedException({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: body.error || 'Invalid email or extension password',
      });
    }
    return { token: body.token, session: body.session };
  }

  async signOut(token: string): Promise<void> {
    this.sessions.forget(token);
    await this.post(ACORN_SIGNOUT_PATH, {}, token).catch(() => undefined);
  }

  private post(path: string, body: unknown, token?: string): Promise<Response> {
    return fetch(`${acornApiUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ACORN_API_TIMEOUT_MS),
    });
  }
}
