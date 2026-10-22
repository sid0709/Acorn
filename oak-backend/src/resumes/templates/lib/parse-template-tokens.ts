export const NAMED_TOKEN_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export type NamedTokenKind =
  | 'anonymous'
  | 'headline'
  | 'summary'
  | 'title'
  | 'bullets'
  | 'category'
  | 'items';

export type NamedTokenMatch = {
  token: string;
  placeholder: string;
  kind: NamedTokenKind;
  section: string;
  experienceIndex?: number;
};

export function classifyNamedToken(name: string): NamedTokenMatch {
  const token = String(name || '').trim();
  const placeholder = `{${token}}`;
  const titleN = /^title(\d+)$/i.exec(token);
  if (titleN) {
    return {
      token,
      placeholder,
      kind: 'title',
      section: 'experience',
      experienceIndex: Math.max(0, Number(titleN[1]) - 1),
    };
  }
  const expN = /^experience(\d+)$/i.exec(token);
  if (expN) {
    return {
      token,
      placeholder,
      kind: 'bullets',
      section: 'experience',
      experienceIndex: Math.max(0, Number(expN[1]) - 1),
    };
  }
  if (token === 'summary') {
    return { token, placeholder, kind: 'summary', section: 'summary' };
  }
  if (token === 'title') {
    return { token, placeholder, kind: 'headline', section: 'title' };
  }
  if (token === 'category_name') {
    return { token, placeholder, kind: 'category', section: 'skills' };
  }
  if (token === 'category_content' || token === 'skills') {
    return { token, placeholder, kind: 'items', section: 'skills' };
  }
  return { token, placeholder, kind: 'summary', section: 'summary' };
}

export function findPlaceholders(text: string): NamedTokenMatch[] {
  const found: NamedTokenMatch[] = [];
  const re = new RegExp(NAMED_TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.push(classifyNamedToken(m[1]));
  }
  if (text.includes('{}')) {
    found.push({
      token: '',
      placeholder: '{}',
      kind: 'anonymous',
      section: '',
    });
  }
  return found;
}
