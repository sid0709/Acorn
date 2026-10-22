/**
 * Extract a one-time / verification code from email text.
 * Keys off generic verification vocabulary — not sender/brand allowlists.
 */

const KEYWORDS =
  'verification|verify|security|one[- ]?time|confirmation|confirm|access|login|log[- ]?in|sign[- ]?in|authenticat(?:e|ion)|otp|passcode|pass ?code|pin|code';

const CODE_AFTER_KEYWORD = new RegExp(
  `(?:${KEYWORDS})[^0-9]{0,40}([0-9]{5,8})`,
  'i',
);
const CODE_BEFORE_KEYWORD = new RegExp(
  `\\b([0-9]{5,8})\\b[^0-9]{0,30}(?:is your|${KEYWORDS})`,
  'i',
);
const ALNUM_NEAR_KEYWORD = new RegExp(
  `(?:${KEYWORDS})[\\s\\S]{0,80}?\\b([A-Za-z0-9]{5,10})\\b`,
  'i',
);
const APPLICATION_FIELD_CODE =
  /(?:application|field)\s*:\s*([A-Za-z0-9]{5,10})\b/i;
const AFTER_PROMPT =
  /(?:paste this code|security code field|your application)[\s\S]{0,240}?\b([A-Za-z0-9]{6,10})\b/i;
const EIGHT_CHAR =
  /(?:paste this code into the security code field|Copy and paste this code)[\s\S]{0,400}?\b([A-Za-z0-9]{8})\b/i;
const SPACED_CODE =
  /\b([0-9])[\s\-–—&nbsp;]{1,3}([0-9])[\s\-–—&nbsp;]{1,3}([0-9])[\s\-–—&nbsp;]{1,3}([0-9])[\s\-–—&nbsp;]{1,3}([0-9])[\s\-–—&nbsp;]{1,3}([0-9])(?:[\s\-–—&nbsp;]{1,3}([0-9])[\s\-–—&nbsp;]{1,3}([0-9]))?\b/;

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<\/?div[^>]*>/gi, '\n')
    .replace(/<\/?td[^>]*>/gi, ' ')
    .replace(/<\/?tr[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract OTP / verification code from subject + body text. */
export function extractVerificationCode(raw: string): string | null {
  const t = String(raw || '');
  if (!t) return null;

  let m = t.match(EIGHT_CHAR);
  if (m && /[0-9]/.test(m[1]) && /[A-Za-z]/.test(m[1])) return m[1];

  m = t.match(APPLICATION_FIELD_CODE);
  if (m && /[0-9A-Za-z]/.test(m[1])) return m[1];

  m = t.match(AFTER_PROMPT);
  if (m && /[0-9]/.test(m[1]) && /[A-Za-z]/.test(m[1])) return m[1];

  m = t.match(ALNUM_NEAR_KEYWORD);
  if (m && /[0-9]/.test(m[1])) return m[1];

  m = t.match(CODE_AFTER_KEYWORD);
  if (m) return m[1];

  m = t.match(CODE_BEFORE_KEYWORD);
  if (m) return m[1];

  m = t.match(SPACED_CODE);
  if (m) {
    const digits = m.slice(1).filter(Boolean).join('');
    if (digits.length >= 4 && digits.length <= 8) return digits;
  }

  if (/<[^>]+>/.test(t)) {
    const plain = htmlToPlainText(t);
    if (plain && plain !== t) return extractVerificationCode(plain);
  }

  return null;
}
