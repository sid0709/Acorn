import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ImapFlow } from 'imapflow';

type PooledClient = {
  client: ImapFlow;
  email: string;
  busy: boolean;
  lastUsedAt: number;
  createdAt: number;
};

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const MAX_CONNS_PER_ACCOUNT = envInt('IMAP_MAX_CONNS_PER_ACCOUNT', 8);
const IDLE_TTL_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

@Injectable()
export class ImapPoolService implements OnModuleDestroy {
  private readonly logger = new Logger(ImapPoolService.name);
  private readonly pools = new Map<string, PooledClient[]>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  async onModuleDestroy() {
    await this.shutdown();
  }

  async withClient<T>(
    email: string,
    password: string,
    mailboxPath: string | undefined,
    fn: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const RETRY_DELAY_MS = 200;
    const MAX_WAIT_MS = 15_000;
    const startedAt = Date.now();

    let entry: PooledClient | null = null;
    while (!entry) {
      entry = await this.acquire(email, password);
      if (!entry) {
        if (Date.now() - startedAt > MAX_WAIT_MS) {
          throw new Error(
            'IMAP connection pool exhausted — all connections busy',
          );
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    try {
      if (mailboxPath) {
        const lock = await entry.client.getMailboxLock(mailboxPath);
        try {
          return await fn(entry.client);
        } finally {
          lock.release();
        }
      }
      return await fn(entry.client);
    } finally {
      entry.busy = false;
      entry.lastUsedAt = Date.now();
    }
  }

  private isConnected(client: ImapFlow): boolean {
    try {
      return client.usable;
    } catch {
      return false;
    }
  }

  private async createClient(
    email: string,
    password: string,
  ): Promise<ImapFlow> {
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: email, pass: password },
      logger: false,
    });
    client.on('error', (err) => {
      this.logger.warn(
        `IMAP connection error for ${email}: ${err?.message || err}`,
      );
    });
    await client.connect();
    return client;
  }

  private getPool(email: string): PooledClient[] {
    let pool = this.pools.get(email);
    if (!pool) {
      pool = [];
      this.pools.set(email, pool);
    }
    return pool;
  }

  private async acquire(
    email: string,
    password: string,
  ): Promise<PooledClient | null> {
    const pool = this.getPool(email);
    const now = Date.now();

    for (const entry of pool) {
      if (entry.busy) continue;
      if (this.isConnected(entry.client)) {
        entry.busy = true;
        entry.lastUsedAt = now;
        return entry;
      }
      try {
        await entry.client.logout();
      } catch {
        /* ignore */
      }
      const idx = pool.indexOf(entry);
      if (idx !== -1) pool.splice(idx, 1);
    }

    if (pool.length < MAX_CONNS_PER_ACCOUNT) {
      const client = await this.createClient(email, password);
      const entry: PooledClient = {
        client,
        email,
        busy: true,
        lastUsedAt: now,
        createdAt: now,
      };
      pool.push(entry);
      return entry;
    }
    return null;
  }

  private sweep() {
    const now = Date.now();
    for (const [email, pool] of this.pools.entries()) {
      for (let i = pool.length - 1; i >= 0; i--) {
        const entry = pool[i];
        if (entry.busy) continue;
        const idleMs = now - entry.lastUsedAt;
        if (idleMs > IDLE_TTL_MS || !this.isConnected(entry.client)) {
          void entry.client.logout().catch(() => {});
          pool.splice(i, 1);
        }
      }
      if (pool.length === 0) this.pools.delete(email);
    }
  }

  async shutdown() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const [, pool] of this.pools.entries()) {
      for (const entry of pool) {
        try {
          await entry.client.logout();
        } catch {
          /* ignore */
        }
      }
    }
    this.pools.clear();
  }
}
