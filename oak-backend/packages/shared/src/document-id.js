import { randomBytes } from 'node:crypto';

const DOCUMENT_ID_PATTERN = /^[a-f0-9]{24}$/i;

/**
 * Firestore document identifier with the legacy 24-hex shape used by existing
 * Athens records. This is intentionally datastore-neutral and has no database
 * client dependency.
 */
export class DocumentId {
  constructor(value = randomBytes(12).toString('hex')) {
    const normalized =
      value instanceof DocumentId
        ? value.toHexString()
        : String(value || '')
            .trim()
            .toLowerCase();
    if (!DOCUMENT_ID_PATTERN.test(normalized))
      throw new TypeError(`Invalid document id: ${value}`);
    this.value = normalized;
  }

  static isValid(value) {
    if (value instanceof DocumentId) return true;
    return DOCUMENT_ID_PATTERN.test(String(value || '').trim());
  }

  toHexString() {
    return this.value;
  }
  toString() {
    return this.value;
  }
  toJSON() {
    return this.value;
  }
  valueOf() {
    return this.value;
  }
  equals(other) {
    return (
      DocumentId.isValid(other) && this.value === String(other).toLowerCase()
    );
  }
}

export function createDocumentId() {
  return new DocumentId();
}

export function isDocumentId(value) {
  return DocumentId.isValid(value);
}
