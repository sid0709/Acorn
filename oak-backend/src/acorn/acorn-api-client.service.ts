import { Injectable } from '@nestjs/common';
import {
  ACORN_API_TIMEOUT_MS,
  ACORN_CLIENT_HEADER_NAME,
  ACORN_TAB_HEADER_NAME,
  OAK_CLIENT,
  acornApiUrl,
} from './acorn.constants';
import { currentAcornContext } from './request-context';

export type AcornApiResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
};

/**
 * Calls acorn-backend as the signed-in person: their own session token, and the
 * tab and client of the request that triggered it, so the model cost of the call
 * lands on the same tab as Oak's own.
 */
@Injectable()
export class AcornApiClient {
  async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    init: {
      token: string;
      json?: unknown;
      bytes?: Buffer;
      contentType?: string;
      timeoutMs?: number;
    },
  ): Promise<AcornApiResult> {
    const context = currentAcornContext();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${init.token}`,
      [ACORN_CLIENT_HEADER_NAME]: context.clientVersion
        ? `${OAK_CLIENT}/${context.clientVersion}`
        : OAK_CLIENT,
    };
    if (context.tabKey) headers[ACORN_TAB_HEADER_NAME] = context.tabKey;
    let body: Blob | string | undefined;
    if (init.bytes) {
      headers['Content-Type'] = init.contentType ?? 'application/octet-stream';
      body = new Blob([new Uint8Array(init.bytes)], {
        type: headers['Content-Type'],
      });
    } else if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    const res = await fetch(`${acornApiUrl()}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(init.timeoutMs ?? ACORN_API_TIMEOUT_MS),
    });
    const parsed = (await res.json().catch(() => ({}))) as unknown;
    return {
      ok: res.ok,
      status: res.status,
      body:
        parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : {},
    };
  }
}

export function acornErrorMessage(
  result: AcornApiResult,
  fallback: string,
): string {
  const { error, message } = result.body;
  if (typeof error === 'string' && error) return error;
  if (typeof message === 'string' && message) return message;
  return fallback;
}
