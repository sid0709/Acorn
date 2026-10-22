import { Injectable } from '@nestjs/common';
import { AcornLibraryService } from '../../acorn/acorn-library.service';
import { withRecommendedResumeAvailable } from './analyze-page';

export type OakFillAnalyzePolicy = {
  recommendedResumeAvailable: boolean;
  page: Record<string, unknown>;
};

@Injectable()
export class OakFillPolicyService {
  constructor(private readonly library: AcornLibraryService) {}

  /** Tells the planner whether the account has a Library résumé to upload. */
  async resolveForAnalyze(input: {
    accountId: string;
    page?: unknown;
  }): Promise<OakFillAnalyzePolicy> {
    const recommendedResumeAvailable = await this.library.hasResume(
      input.accountId,
    );
    return {
      recommendedResumeAvailable,
      page: withRecommendedResumeAvailable(
        input.page,
        recommendedResumeAvailable,
      ),
    };
  }
}
