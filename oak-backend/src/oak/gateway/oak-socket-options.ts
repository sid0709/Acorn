import type { ServerOptions } from 'socket.io';
import { OAK_SOCKET_PATH } from '../constants/oak.constants';

/**
 * Socket.io options for the Oak gateway (path `/oak`).
 * Cookie disabled: chrome-extension:// cannot rely on Engine.IO sticky cookies.
 * perMessageDeflate off: nginx and some proxies mishandle WS compression.
 */
export function oakSocketServerOptions(): Partial<ServerOptions> {
  return {
    path: OAK_SOCKET_PATH,
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    cookie: false,
    perMessageDeflate: false,
    /**
     * Origin stays reflective because extension origins are per-install, but
     * credentials are off: the session token travels in the handshake auth
     * payload, never a cookie, so no ambient credential can be replayed by a
     * hostile origin.
     */
    cors: {
      origin: true,
      methods: ['GET', 'POST'],
      credentials: false,
    },
    /** DOM trees run a few MB after serializer caps; this keeps ~3x headroom. */
    maxHttpBufferSize: 16e6,
  };
}
