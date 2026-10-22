import { parseClientVersion, parseTabKey } from './request-context';

describe('request context headers', () => {
  it('accepts a tab key like acorn-backend does', () => {
    expect(parseTabKey('3f2b9c1e-aaaa-bbbb-cccc-0123456789ab')).toBe(
      '3f2b9c1e-aaaa-bbbb-cccc-0123456789ab',
    );
  });

  it('drops keys that are too short, too long or not plain', () => {
    expect(parseTabKey('short')).toBe('');
    expect(parseTabKey('a'.repeat(65))).toBe('');
    expect(parseTabKey('has space in it')).toBe('');
  });

  it('reads the version of "oak/1.2.3"', () => {
    expect(parseClientVersion('oak/1.2.3')).toBe('1.2.3');
    expect(parseClientVersion('oak')).toBe('');
    expect(parseClientVersion('oak/bad version')).toBe('');
  });
});
