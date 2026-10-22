export const POSTING_COMPANIES_PAGE_SIZE = 48;
export const POSTING_COMPANIES_MAX_PAGE_SIZE = 100;

export const POSTING_COMPANY_SORTS = ['recent', 'volume'] as const;
export type PostingCompanySort = (typeof POSTING_COMPANY_SORTS)[number];
