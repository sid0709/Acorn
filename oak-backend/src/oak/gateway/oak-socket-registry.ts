export type OakSocketClientInfo = {
  /** Tenant key. Every relay and broadcast is scoped to this value. */
  accountId: string;
  type: string;
  name: string;
  profileId: string;
  applierName: string;
  connectedAt: number;
};

export class OakSocketRegistry {
  private readonly clients = new Map<string, OakSocketClientInfo>();

  set(id: string, info: OakSocketClientInfo): void {
    this.clients.set(id, info);
  }

  delete(id: string): void {
    this.clients.delete(id);
  }

  /** Clients belonging to one account. Never expose other tenants' sockets. */
  summaryFor(accountId: string) {
    const out: Array<{ id: string } & OakSocketClientInfo> = [];
    for (const [id, info] of this.clients.entries()) {
      if (info.accountId === accountId) out.push({ id, ...info });
    }
    return out;
  }

  count(): number {
    return this.clients.size;
  }

  /** True when `socketId` is connected and belongs to `accountId`. */
  isOwnedBy(socketId: string, accountId: string): boolean {
    const info = this.clients.get(socketId);
    return Boolean(info && info.accountId === accountId);
  }

  findExtensionSocketId(accountId: string): string | null {
    for (const [id, info] of this.clients.entries()) {
      if (info.accountId === accountId && info.type === 'extension') return id;
    }
    return null;
  }
}

export function countDomNodes(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const children = (node as { children?: unknown[] }).children;
  if (!Array.isArray(children)) return 1;
  let childSum = 0;
  for (const child of children) childSum += countDomNodes(child);
  return 1 + childSum;
}
