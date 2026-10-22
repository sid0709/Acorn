import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentId } from './document-id.js';

test('document ids preserve the existing 24-hex identifier format', () => {
  const generated = new DocumentId();
  assert.match(generated.toHexString(), /^[a-f0-9]{24}$/);
  assert.equal(DocumentId.isValid(generated), true);
  assert.equal(
    new DocumentId('ABCDEF0123456789ABCDEF01').toString(),
    'abcdef0123456789abcdef01',
  );
  assert.equal(DocumentId.isValid('not-an-id'), false);
});
