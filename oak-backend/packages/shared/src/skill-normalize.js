/**
 * Canonical skill normalization + static alias resolution.
 * Single source of truth for job/profile skill matching.
 */

/** @type {Record<string, string[]>} canonical -> aliases */
const STATIC_ALIASES = {
  typescript: ['ts', 'typescript', 'type script'],
  javascript: ['js', 'javascript', 'ecmascript'],
  'node.js': ['node', 'nodejs', 'node js', 'node.js'],
  'c#': ['c#', 'csharp', 'c sharp'],
  aws: ['aws', 'amazon web services'],
  azure: ['azure', 'microsoft azure'],
  'github actions': ['github actions', 'gh actions'],
  terraform: ['terraform', 'tf', 'iac terraform'],
  'distributed systems': ['distributed systems', 'distributed system'],
  'microservices architecture': [
    'microservices',
    'microservices architecture',
    'microservice',
  ],
  'test-driven development': [
    'tdd',
    'test-driven development',
    'test driven development',
    'test-driven development (tdd)',
  ],
  'behavior-driven development': [
    'bdd',
    'behavior-driven development',
    'behavior driven development',
    'behavior-driven development (bdd)',
  ],
  react: ['react', 'reactjs', 'react.js'],
  'react native': ['react native', 'react-native', 'rn'],
  python: ['python', 'py'],
  java: ['java'],
  kubernetes: ['kubernetes', 'k8s'],
  docker: ['docker', 'containerization'],
  postgresql: ['postgresql', 'postgres', 'psql'],
  mongodb: ['mongodb', 'mongo'],
  graphql: ['graphql', 'graph ql'],
  'next.js': ['nextjs', 'next.js', 'next js'],
  vue: ['vue', 'vuejs', 'vue.js'],
  angular: ['angular', 'angularjs'],
  golang: ['go', 'golang'],
  rust: ['rust'],
  swift: ['swift'],
  kotlin: ['kotlin'],
  redis: ['redis'],
  kafka: ['kafka', 'apache kafka'],
  elasticsearch: ['elasticsearch', 'elastic search', 'es'],
  'machine learning': ['machine learning', 'ml'],
  'artificial intelligence': ['artificial intelligence', 'ai'],
};

const ALIAS_TO_CANONICAL = new Map();
for (const [canonical, aliases] of Object.entries(STATIC_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(normalizeRaw(alias), canonical);
  }
  ALIAS_TO_CANONICAL.set(normalizeRaw(canonical), canonical);
}

/** Lowercase, strip punctuation noise, collapse whitespace. */
export function normalizeRaw(skill) {
  return String(skill ?? '')
    .trim()
    .toLowerCase()
    .replace(/[./]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolve a skill string to its canonical form (alias map or normalized raw). */
export function toCanonical(skill) {
  const raw = normalizeRaw(skill);
  if (!raw) return '';
  return ALIAS_TO_CANONICAL.get(raw) || raw;
}

/** Normalize an array of skills to unique canonical set. */
export function normalizeSkillSet(skills = []) {
  const out = new Set();
  for (const s of skills) {
    const c = toCanonical(s);
    if (c) out.add(c);
  }
  return out;
}

/** Merge optional runtime aliases from the persisted skill dictionary. */
export function mergeAliases(aliasDocs = []) {
  for (const doc of aliasDocs) {
    const canonical = toCanonical(doc.canonical || doc.canonicalId || '');
    if (!canonical) continue;
    const aliases = Array.isArray(doc.aliases) ? doc.aliases : [];
    for (const a of aliases) {
      const raw = normalizeRaw(a);
      if (raw) ALIAS_TO_CANONICAL.set(raw, canonical);
    }
    ALIAS_TO_CANONICAL.set(canonical, canonical);
  }
}

export { STATIC_ALIASES };
