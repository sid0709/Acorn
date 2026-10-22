import { OakSocketRegistry } from './oak-socket-registry';

const client = (accountId: string, type: string) => ({
  accountId,
  type,
  name: `${accountId}-${type}`,
  profileId: accountId,
  applierName: accountId,
  connectedAt: 1,
});

describe('OakSocketRegistry tenant scoping', () => {
  let registry: OakSocketRegistry;

  beforeEach(() => {
    registry = new OakSocketRegistry();
    registry.set('a-ext', client('acct-a', 'extension'));
    registry.set('a-board', client('acct-a', 'ui-board'));
    registry.set('b-ext', client('acct-b', 'extension'));
  });

  it('summarizes only the caller account clients', () => {
    const ids = registry
      .summaryFor('acct-a')
      .map((row) => row.id)
      .sort();
    expect(ids).toEqual(['a-board', 'a-ext']);
    expect(registry.summaryFor('acct-b').map((row) => row.id)).toEqual([
      'b-ext',
    ]);
  });

  it('never returns another account extension socket', () => {
    expect(registry.findExtensionSocketId('acct-a')).toBe('a-ext');
    expect(registry.findExtensionSocketId('acct-b')).toBe('b-ext');
    expect(registry.findExtensionSocketId('acct-c')).toBeNull();
  });

  it('rejects a caller-supplied socket id owned by another account', () => {
    expect(registry.isOwnedBy('a-ext', 'acct-a')).toBe(true);
    expect(registry.isOwnedBy('b-ext', 'acct-a')).toBe(false);
    expect(registry.isOwnedBy('missing', 'acct-a')).toBe(false);
  });

  it('stops resolving a socket once it disconnects', () => {
    registry.delete('a-ext');
    expect(registry.isOwnedBy('a-ext', 'acct-a')).toBe(false);
    expect(registry.findExtensionSocketId('acct-a')).toBeNull();
  });
});
