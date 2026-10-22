import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'enc:v1:';

function loadKey() {
  const raw = String(process.env.API_KEYS_ENCRYPTION_KEY ?? '').trim();
  if (!raw) {
    throw new Error(
      'API_KEYS_ENCRYPTION_KEY is required to encrypt API keys. Generate one with: openssl rand -hex 32',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'API_KEYS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(raw, 'hex');
}

export function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext) {
  const text = String(plaintext ?? '');
  if (!text) return '';
  if (isEncryptedSecret(text)) return text;

  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString('base64');
  return `${PREFIX}${payload}`;
}

export function decryptSecret(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (!isEncryptedSecret(text)) return text;

  const key = loadKey();
  const payload = Buffer.from(text.slice(PREFIX.length), 'base64');
  if (payload.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('Invalid encrypted secret payload');
  }

  const iv = payload.subarray(0, IV_LEN);
  const tag = payload.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = payload.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
