import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import {
  ACORN_CLIENT_HEADER,
  ACORN_CLIENT_NAME_MAX,
  ACORN_CLIENT_VERSION_MAX,
  ACORN_TAB_HEADER,
  ACORN_TAB_KEY_MAX,
  ACORN_TAB_KEY_MIN,
} from './acorn.constants';

/** Which Chrome tab and which build a request came from. */
export type AcornRequestContext = { tabKey: string; clientVersion: string };

const storage = new AsyncLocalStorage<AcornRequestContext>();

const TAB_KEY = /^[A-Za-z0-9-]+$/;
const TOKEN = /^[A-Za-z0-9._-]+$/;

function header(req: Request, name: string): string {
  const raw = req.headers[name];
  return (Array.isArray(raw) ? raw[0] : raw || '').trim();
}

export function parseTabKey(raw: string): string {
  const key = raw.trim();
  return key.length >= ACORN_TAB_KEY_MIN &&
    key.length <= ACORN_TAB_KEY_MAX &&
    TAB_KEY.test(key)
    ? key
    : '';
}

export function parseClientVersion(raw: string): string {
  const [name = '', version = ''] = raw.trim().split('/');
  if (name.length > ACORN_CLIENT_NAME_MAX || !TOKEN.test(name || '-'))
    return '';
  return version.length <= ACORN_CLIENT_VERSION_MAX &&
    (version === '' || TOKEN.test(version))
    ? version
    : '';
}

/** Makes the tab key and client version of the request readable anywhere below it. */
export function acornRequestContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  storage.run(
    {
      tabKey: parseTabKey(header(req, ACORN_TAB_HEADER)),
      clientVersion: parseClientVersion(header(req, ACORN_CLIENT_HEADER)),
    },
    next,
  );
}

export function currentAcornContext(): AcornRequestContext {
  return storage.getStore() ?? { tabKey: '', clientVersion: '' };
}
