import type { Socket } from 'socket.io';

/**
 * Handshake auth payload or an Authorization header only. Query-string tokens are
 * deliberately not accepted: URLs are recorded by proxies, nginx access logs and
 * browser history, so a session token there leaks outside the TLS payload.
 */
export function extractOakSocketToken(socket: Socket): string {
  const auth = socket.handshake.auth as { token?: string } | undefined;
  if (typeof auth?.token === 'string' && auth.token.trim()) {
    return auth.token.trim();
  }
  const header = String(socket.handshake.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match?.[1]?.trim()) return match[1].trim();
  return '';
}
