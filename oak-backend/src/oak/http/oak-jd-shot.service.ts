import { HttpException, Injectable } from '@nestjs/common';
import {
  ACORN_RECOMMEND_PATH,
  ACORN_RECOMMEND_TIMEOUT_MS,
} from '../../acorn/acorn.constants';
import {
  AcornApiClient,
  acornErrorMessage,
} from '../../acorn/acorn-api-client.service';

/** acorn-backend answers 422 when the text is not a job posting. */
const STATUS_NO_POSTING = 422;

type RankedResume = { resumeId: string; stack: string; probability: number };

/**
 * JD shot: the page's text goes to acorn-backend's recommend, where Jev first
 * decides whether it is a job posting and then ranks the Library résumés.
 */
@Injectable()
export class OakJdShotService {
  constructor(private readonly acorn: AcornApiClient) {}

  async run(token: string, pageText: string) {
    const res = await this.acorn.request('POST', ACORN_RECOMMEND_PATH, {
      token,
      json: { jobDescription: pageText },
      timeoutMs: ACORN_RECOMMEND_TIMEOUT_MS,
    });
    if (res.status === STATUS_NO_POSTING) {
      return {
        success: true as const,
        hasJobDescription: false,
        reason: acornErrorMessage(res, 'No job description on this page'),
        resumeId: null,
        stack: null,
        matchReason: null,
        top: [] as RankedResume[],
      };
    }
    if (!res.ok) {
      throw new HttpException(
        {
          success: false,
          error: acornErrorMessage(res, 'Could not recommend a résumé'),
          code: res.body.code,
        },
        res.status,
      );
    }
    const { body } = res;
    return {
      success: true as const,
      hasJobDescription: true,
      reason: null,
      resumeId: asString(body.recommendedResumeId),
      stack: asString(body.recommendedResumeStack),
      matchReason: asString(body.recommendedResumeReason),
      top: Array.isArray(body.recommendedTop)
        ? (body.recommendedTop as RankedResume[])
        : [],
    };
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
