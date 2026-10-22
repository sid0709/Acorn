/** Singleton `athens_metadata.key` for product-wide config. */
export const ATHENS_METADATA_GLOBAL_KEY = 'global';

export const COMPANY_BLOCKED_CODE = 'COMPANY_BLOCKED' as const;

export const COMPANY_BLOCKED_REASON = 'Company is blocked';

/** Max saved block rules on the global metadata document. */
export const COMPANY_BLOCK_RULES_MAX = 200;

/** Preview + remove batch size for matching catalog / staging jobs. */
export const COMPANY_BLOCK_SEARCH_LIMIT = 500;

export const COMPANY_BLOCK_NAME_MAX = 200;
