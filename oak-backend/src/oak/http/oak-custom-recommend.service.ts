import { BadRequestException, Injectable } from '@nestjs/common';
import { LlmAdmissionService } from '../../ai/concurrency/llm-admission.service';
import { appLogger } from '../../common/logger/app-logger';
import { RecommendOneService } from '../../jobs/recommend/recommend-one.service';
import { ResumeLibraryCatalogService } from '../../resumes/resume-library-catalog.service';
import { cleanString } from '../../resumes/generator/lib/clean-string';
import type { OakPublicSession } from '../auth/oak-session.service';

const CUSTOM_RECOMMEND_PATH = '/api/oak/custom/recommend';

@Injectable()
export class OakCustomRecommendService {
  private readonly log = appLogger(OakCustomRecommendService.name);

  constructor(
    private readonly admission: LlmAdmissionService,
    private readonly recommendOne: RecommendOneService,
    private readonly libraryCatalog: ResumeLibraryCatalogService,
  ) {}

  /** Same Library catalog + LLM match as Job Search recommend; no vendor_tasks write. */
  async recommendForSession(
    session: OakPublicSession,
    input: { jobDescription: unknown; title?: unknown; url?: unknown },
  ) {
    const jobDescription = cleanString(input.jobDescription);
    if (!jobDescription) {
      throw new BadRequestException({
        success: false,
        error: 'jobDescription is required',
      });
    }

    const catalog = await this.libraryCatalog.compressForProfile(
      session.profileId,
    );
    const outcome = await this.admission.run(session.profileId, () =>
      this.recommendOne.fromPageText({
        applierName: session.applierName,
        pageText: jobDescription,
        catalog,
        title: cleanString(input.title) || undefined,
        url: cleanString(input.url) || undefined,
        usagePath: CUSTOM_RECOMMEND_PATH,
      }),
    );

    const stack =
      outcome.result.matchedCatalogKey || outcome.result.recommendedResume;
    const resumeId = stack
      ? await this.libraryCatalog.findIdByStack(session.profileId, stack)
      : null;
    if (!stack || !resumeId) {
      throw new BadRequestException({
        success: false,
        error:
          outcome.result.warning ||
          outcome.result.reason ||
          'No Library resume matched this posting',
      });
    }

    this.log.info(
      {
        resumeId,
        stack,
        mode: outcome.mode,
      },
      'oak custom library recommend',
    );
    return {
      success: true as const,
      recommendedResumeStack: stack,
      recommendedResumeId: resumeId,
      recommendedResumeReason: outcome.result.reason,
      warning: outcome.result.warning,
      mode: outcome.mode,
    };
  }
}
