/** Readable names for the keys acorn-backend groups by. Unknown keys show as they are. */

const FEATURES: Record<string, string> = {
  fill: "Fill page",
  ask: "Ask",
  run: "Run",
  custom_job: "Custom job read",
  resume_generate: "Résumé generate",
  resume_analyze: "Résumé analyze",
  recommend: "Recommend",
  profile_import: "Profile import",
  gmail_label: "Gmail labels",
  unknown: "Untagged",
};

const ERROR_KINDS: Record<string, string> = {
  timeout: "Timeout",
  rate_limited: "Rate limited",
  auth: "Key rejected",
  bad_request: "Bad request",
  provider_error: "Provider error",
  network: "Network",
  empty_response: "Empty answer",
  parse_error: "Unreadable answer",
  no_api_key: "No API key",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

const CLIENTS: Record<string, string> = {
  extension: "Extension",
  web: "Website",
  unknown: "Unknown",
};

export const featureLabel = (key: string) => FEATURES[key] ?? key;
export const errorKindLabel = (key: string) => ERROR_KINDS[key] ?? key;
export const clientLabel = (key: string) => CLIENTS[key] ?? key;
