import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  OakSessionService,
  type OakPublicSession,
} from '../auth/oak-session.service';
import { OAK_SOCKET_PATH } from '../constants/oak.constants';
import { oakSocketServerOptions } from './oak-socket-options';
import { countDomNodes, OakSocketRegistry } from './oak-socket-registry';
import { extractOakSocketToken } from './oak-socket-token';

type OakEngineConnectionError = {
  code?: number;
  message?: string;
  context?: { name?: string };
};

/**
 * Socket.io room for one Athens account. Every DOM payload, progress event and
 * relayed command stays inside this room: page trees and fill commands must
 * never cross between accounts.
 */
function accountRoom(session: OakPublicSession): string {
  return `oak:acct:${session.accountId || session.profileId}`;
}

@Injectable()
export class OakGatewayBootstrap implements OnModuleDestroy {
  private readonly logger = new Logger(OakGatewayBootstrap.name);
  private readonly registry = new OakSocketRegistry();
  private io: Server | null = null;

  constructor(private readonly sessions: OakSessionService) {}

  attach(httpServer: HttpServer): void {
    if (this.io) return;

    // Token-auth already gates the socket; allow extension origins like standalone Oak did.
    this.io = new Server(httpServer, oakSocketServerOptions());

    this.io.engine.on('connection_error', (err: OakEngineConnectionError) => {
      const name = err.context?.name ?? 'unknown';
      const code = err.code ?? '?';
      this.logger.warn(
        `Oak Engine.IO connection_error code=${code} name=${name} ${err.message ?? ''}`.trim(),
      );
    });

    this.io.use(async (socket, next) => {
      try {
        const token = extractOakSocketToken(socket);
        if (!token) {
          next(new Error('Oak session required'));
          return;
        }
        const session = await this.sessions.read(token);
        if (!session) {
          next(new Error('Oak session expired or invalid'));
          return;
        }
        socket.data.oakSession = session;
        next();
      } catch (err) {
        next(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.io.on('connection', (socket) => this.onConnection(socket));
    this.logger.log(
      `Oak Socket.io attached at path ${OAK_SOCKET_PATH} (websocket+polling)`,
    );
  }

  onModuleDestroy(): void {
    void this.io?.close();
    this.io = null;
  }

  private onConnection(socket: Socket): void {
    const io = this.io!;
    const session = socket.data.oakSession as OakPublicSession;
    const room = accountRoom(session);
    const accountId = session.accountId || session.profileId;
    const type = String(socket.handshake.query.type || 'unknown');
    const name = String(
      socket.handshake.query.name || session.username || 'anonymous',
    );

    void socket.join(room);
    this.registry.set(socket.id, {
      accountId,
      type,
      name,
      profileId: session.profileId,
      applierName: session.applierName,
      connectedAt: Date.now(),
    });

    this.logger.log(`[${type}] connected: ${name} (${socket.id})`);

    socket.emit('connected', {
      id: socket.id,
      type,
      clients: this.registry.summaryFor(accountId),
    });
    io.to(room).emit('clients:update', this.registry.summaryFor(accountId));

    socket.on('dom:tree', (payload: Record<string, unknown>) => {
      const meta = {
        from: socket.id,
        clientType: type,
        clientName: name,
        url: payload?.url ?? 'unknown',
        title: payload?.title ?? 'unknown',
        tabId: payload?.tabId ?? null,
        frameId: payload?.frameId ?? null,
        timestamp: Date.now(),
        nodeCount: countDomNodes(payload?.tree),
      };
      this.logger.log(
        `[dom:tree] from ${name} — ${meta.nodeCount} nodes @ ${meta.url}`,
      );
      socket.to(room).emit('dom:tree', { ...payload, meta });
      socket.emit('dom:tree:sent', meta);
    });

    socket.on('pipeline:progress', (payload: Record<string, unknown>) => {
      const progress = payload?.progress as { phase?: string } | undefined;
      const phase = progress?.phase ?? payload?.phase ?? 'unknown';
      this.logger.log(
        `[pipeline:progress] tab=${payload?.tabId ?? null} phase=${phase}`,
      );
      socket.to(room).emit('pipeline:progress', payload);
    });

    socket.on('dom:highlight', (payload: Record<string, unknown>) => {
      const { extensionId, nodeId, tabId, url } = payload ?? {};
      if (nodeId == null || !tabId) return;
      if (typeof extensionId === 'string' && extensionId) {
        if (!this.registry.isOwnedBy(extensionId, accountId)) {
          this.logger.warn(
            `[dom:highlight] rejected cross-account target from ${socket.id}`,
          );
          return;
        }
        io.to(extensionId).emit('dom:highlight', { nodeId, tabId, url });
        return;
      }
      for (const client of this.registry.summaryFor(accountId)) {
        if (client.type === 'extension') {
          io.to(client.id).emit('dom:highlight', { nodeId, tabId, url });
        }
      }
    });

    socket.on(
      'dom:get-content',
      (payload: Record<string, unknown>, ack?: (res: unknown) => void) => {
        this.relayToExtension(
          accountId,
          payload,
          'dom:get-content',
          ack,
          15_000,
        );
      },
    );

    socket.on(
      'dom:execute-actions',
      (payload: Record<string, unknown>, ack?: (res: unknown) => void) => {
        this.relayToExtension(
          accountId,
          payload,
          'dom:execute-actions',
          ack,
          60_000,
        );
      },
    );

    socket.on(
      'dom:plan-step',
      (payload: Record<string, unknown>, ack?: (res: unknown) => void) => {
        this.relayPlanStepToExtension(accountId, payload, ack, 45_000);
      },
    );

    socket.on('disconnect', () => {
      this.registry.delete(socket.id);
      this.logger.log(`[${type}] disconnected: ${name} (${socket.id})`);
      io.to(room).emit('clients:update', this.registry.summaryFor(accountId));
    });
  }

  /**
   * Resolve the extension socket a command may target. A caller-supplied
   * `extensionId` is honoured only when that socket belongs to the same account,
   * so one tenant can never drive another tenant's browser.
   */
  private resolveExtensionTarget(
    accountId: string,
    extensionId: unknown,
  ): { id: string } | { error: string } {
    if (typeof extensionId === 'string' && extensionId) {
      if (!this.registry.isOwnedBy(extensionId, accountId)) {
        return { error: 'No extension connected' };
      }
      return { id: extensionId };
    }
    const found = this.registry.findExtensionSocketId(accountId);
    return found ? { id: found } : { error: 'No extension connected' };
  }

  private relayToExtension(
    accountId: string,
    payload: Record<string, unknown> | undefined,
    event: string,
    ack?: (res: unknown) => void,
    timeoutMs = 15_000,
  ): void {
    const io = this.io!;
    const { extensionId, nodeId, tabId } = payload ?? {};
    if (nodeId == null || !tabId) {
      ack?.({ error: 'Missing nodeId or tabId' });
      return;
    }

    const target = this.resolveExtensionTarget(accountId, extensionId);
    if ('error' in target) {
      ack?.({ error: target.error });
      return;
    }

    const extSocket = io.sockets.sockets.get(target.id);
    if (!extSocket) {
      ack?.({ error: 'Extension socket not found' });
      return;
    }

    extSocket
      .timeout(timeoutMs)
      .emit(event, payload, (err: Error, res: unknown) => {
        if (err) {
          ack?.({ error: err.message ?? 'Extension request timed out' });
          return;
        }
        ack?.(res ?? { error: 'No response from extension' });
      });
  }

  private relayPlanStepToExtension(
    accountId: string,
    payload: Record<string, unknown> | undefined,
    ack?: (res: unknown) => void,
    timeoutMs = 45_000,
  ): void {
    const io = this.io!;
    const { extensionId, tabId, step, frameId } = payload ?? {};
    const stepObj = step as
      { action?: string; element_index?: number } | undefined;
    if (!tabId || !stepObj?.action) {
      ack?.({ ok: false, error: 'Missing tabId or step' });
      return;
    }

    const target = this.resolveExtensionTarget(accountId, extensionId);
    if ('error' in target) {
      ack?.({ ok: false, error: target.error });
      return;
    }

    const extSocket = io.sockets.sockets.get(target.id);
    if (!extSocket) {
      ack?.({ ok: false, error: 'Extension socket not found' });
      return;
    }

    this.logger.log(
      `[dom:plan-step] ${stepObj.action} index=${stepObj.element_index ?? '-'} tab=${tabId} frame=${frameId ?? 'auto'}`,
    );

    extSocket
      .timeout(timeoutMs)
      .emit('dom:plan-step', payload, (err: Error, res: unknown) => {
        if (err) {
          ack?.({
            ok: false,
            error: err.message ?? 'Extension request timed out',
          });
          return;
        }
        ack?.(res ?? { ok: false, error: 'No response from extension' });
      });
  }
}
