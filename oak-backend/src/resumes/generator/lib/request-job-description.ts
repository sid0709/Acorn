import { cleanString } from './clean-string';

/** JD snapshot stored on a generation input request. */
export function requestJobDescription(request: unknown): string {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return '';
  }
  return cleanString((request as { jobDescription?: unknown }).jobDescription);
}
