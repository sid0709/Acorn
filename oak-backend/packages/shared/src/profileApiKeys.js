import { decryptSecret, encryptSecret } from './secretCrypto.js';

export const PROFILE_API_KEY_FIELDS = ['openaiApiKey', 'deepseekApiKey'];

export function encryptProfileApiKeys(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const out = { ...profile };
  for (const field of PROFILE_API_KEY_FIELDS) {
    if (typeof out[field] === 'string' && out[field]) {
      out[field] = encryptSecret(out[field]);
    }
  }
  return out;
}

export function decryptProfileApiKeys(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const out = { ...profile };
  for (const field of PROFILE_API_KEY_FIELDS) {
    if (typeof out[field] === 'string' && out[field]) {
      out[field] = decryptSecret(out[field]);
    }
  }
  return out;
}
