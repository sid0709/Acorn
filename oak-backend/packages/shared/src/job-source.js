/**
 * Canonical job-source catalog (Job Search filter + ingest inference + Analytics).
 * Match apply-link hosts against `url` tokens; longest token wins.
 */

export const JOB_SOURCES = Object.freeze([
  Object.freeze({ type: 'Legal', title: 'LinkedIn', url: 'linkedin.com' }),
  Object.freeze({ type: 'Legal', title: 'Indeed', url: 'indeed.com' }),
  Object.freeze({
    type: 'Legal',
    title: 'ZipRecruiter',
    url: 'ziprecruiter.com',
  }),
  Object.freeze({ type: 'Legal', title: 'Wellfound', url: 'wellfound.com' }),
  Object.freeze({ type: 'Legal', title: 'Dice', url: 'dice.com' }),
  Object.freeze({ type: 'Autobid', title: 'Greenhouse', url: 'greenhouse.io' }),
  Object.freeze({
    type: 'Autobid',
    title: 'Workday',
    url: 'myworkdayjobs.com | myworkdaysite.com',
  }),
  Object.freeze({ type: 'Extension', title: 'Workable', url: 'workable.com' }),
  Object.freeze({ type: 'Extension', title: 'Ashby', url: 'ashbyhq.com' }),
  Object.freeze({ type: 'Extension', title: 'Lever', url: 'lever.co' }),
  Object.freeze({ type: 'OneStep', title: 'Jobvite', url: 'jobvite.com' }),
  Object.freeze({
    type: 'OneStep',
    title: 'SmartRecruiters',
    url: 'smartrecruiters.com',
  }),
  Object.freeze({ type: 'OneStep', title: 'BambooHR', url: 'bamboohr.com' }),
  Object.freeze({ type: 'OneStep', title: 'Recruitee', url: 'recruitee.com' }),
  Object.freeze({
    type: 'OneStep',
    title: 'Teamtailor',
    url: 'teamtailor.com',
  }),
  Object.freeze({ type: 'OneStep', title: 'Personio', url: 'personio.com' }),
  Object.freeze({ type: 'OneStep', title: 'Rippling', url: 'rippling.com' }),
  Object.freeze({ type: 'OneStep', title: 'Dover', url: 'dover.com' }),
  Object.freeze({
    type: 'OneStep',
    title: 'Applytojob',
    url: 'applytojob.com',
  }),
  Object.freeze({ type: 'OneStep', title: 'Jobdiva', url: 'jobdiva.com' }),
  Object.freeze({ type: 'OneStep', title: 'Breezy', url: 'breezy.hr' }),
  Object.freeze({ type: 'OneStep', title: 'Gusto', url: 'gusto.com' }),
  Object.freeze({
    type: 'OneStep',
    title: 'Rippling-ATS',
    url: 'rippling-ats.com',
  }),
  Object.freeze({
    type: 'OneStep',
    title: 'Pinpointhq',
    url: 'pinpointhq.com',
  }),
  Object.freeze({ type: 'OneStep', title: 'Freshteam', url: 'freshteam.com' }),
  Object.freeze({
    type: 'OneStep',
    title: 'Recruiterflow',
    url: 'recruiterflow.com',
  }),
  Object.freeze({ type: 'OneStep', title: 'Gem', url: 'gem.com' }),
  Object.freeze({
    type: 'MultiStep',
    title: 'OracleCloud',
    url: 'oraclecloud.com',
  }),
  Object.freeze({
    type: 'MultiStep',
    title: 'Paylocity',
    url: 'paylocity.com',
  }),
  Object.freeze({ type: 'MultiStep', title: 'ADP', url: 'adp.com' }),
  Object.freeze({ type: 'MultiStep', title: 'iCIMS', url: 'icims.com' }),
  Object.freeze({ type: 'MultiStep', title: 'UltiPro', url: 'ultipro.com' }),
  Object.freeze({ type: 'MultiStep', title: 'UKG', url: 'ukg.net' }),
  Object.freeze({
    type: 'MultiStep',
    title: 'Paycom',
    url: 'paycomonline.net',
  }),
  Object.freeze({
    type: 'MultiStep',
    title: 'DayforceHCM',
    url: 'dayforcehcm.com',
  }),
  Object.freeze({
    type: 'MultiStep',
    title: 'Zohorecruit',
    url: 'zohorecruit.com',
  }),
  Object.freeze({
    type: 'MultiStep',
    title: 'BestJobTool',
    url: 'bestjobtool.com',
  }),
  Object.freeze({ type: 'MultiStep', title: 'Taleo', url: 'taleo.net' }),
  Object.freeze({ type: 'Other', title: 'Other', url: '' }),
]);

/** Bump when catalog entries or url tokens change (for cleanse / reclassify). */
export const SOURCE_MAP_VERSION = '3';

export const JOB_SOURCE_TITLES = Object.freeze(JOB_SOURCES.map((s) => s.title));

/** Source titles grouped by `type`, preserving declaration order. */
export const JOB_SOURCE_GROUPS = (() => {
  const order = [];
  const byType = new Map();
  for (const s of JOB_SOURCES) {
    if (!byType.has(s.type)) {
      byType.set(s.type, []);
      order.push(s.type);
    }
    byType.get(s.type).push(s.title);
  }
  return Object.freeze(
    order.map((type) =>
      Object.freeze({ type, titles: Object.freeze(byType.get(type)) }),
    ),
  );
})();

const SOURCE_TOKENS = JOB_SOURCES.filter((s) => s.title !== 'Other' && s.url)
  .flatMap((s) =>
    String(s.url)
      .split('|')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .map((token) => ({ token, title: s.title })),
  )
  .sort((a, b) => b.token.length - a.token.length);
export const JOB_SCRAPE_SOURCE_TITLES = Object.freeze([
  'li-job-scraper',
  'avalon-scrapper',
  'hiringcafe',
  'jobcakes',
  'builtin',
  'Other',
]);

export const OTHER_JOB_SCRAPE_SOURCE = 'Other';

/**
 * Canonical job source for an apply link: match hostname against catalog url tokens.
 * Prefers the longest matching token (e.g. rippling-ats.com over rippling.com).
 */
export function inferJobSource(applyLink) {
  const url = String(applyLink ?? '')
    .trim()
    .toLowerCase();
  if (!url) return 'Other';

  let host = url;
  if (host.startsWith('https://')) host = host.slice(8);
  else if (host.startsWith('http://')) host = host.slice(7);
  const slash = host.indexOf('/');
  if (slash !== -1) host = host.slice(0, slash);

  for (const { token, title } of SOURCE_TOKENS) {
    if (host.includes(token)) return title;
  }
  return 'Other';
}
