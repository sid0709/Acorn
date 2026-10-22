import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  OAK_FILL_RESUME_REQUIRED_CODE,
  OAK_FILL_RESUME_REQUIRED_MESSAGE,
  OAK_NON_ADMIN_ACTION_TEMPERATURE,
} from '../constants/oak-admin.constants';
import { OakCustomLibraryResumeService } from '../http/oak-custom-library-resume.service';
import { OakCustomResumeService } from '../http/oak-custom-resume.service';
import { OakRecommendedResumeService } from '../http/oak-recommended-resume.service';
import {
  customGenerationIdFromPage,
  customLibraryResumeIdFromPage,
  customRememberedFromPage,
  jobIdFromPage,
  withRecommendedResumeAvailable,
} from './analyze-page';
import { applyActionTemperature } from './apply-action-temperature';
import { oakFillResumeSatisfied } from './oak-fill-allowed';
import { OakAdminPrivilegesService } from './oak-admin-privileges.service';

export type OakFillAnalyzePolicy = {
  isAdmin: boolean;
  recommendedResumeAvailable: boolean;
  page: Record<string, unknown>;
};

@Injectable()
export class OakFillPolicyService {
  constructor(
    private readonly admin: OakAdminPrivilegesService,
    private readonly recommendedResume: OakRecommendedResumeService,
    private readonly customResumes: OakCustomResumeService,
    private readonly libraryResumes: OakCustomLibraryResumeService,
  ) {}

  async resolveForAnalyze(input: {
    applierName: string;
    page?: unknown;
  }): Promise<OakFillAnalyzePolicy> {
    const isAdmin = await this.admin.isAdmin(input.applierName);
    const jobId = jobIdFromPage(input.page);
    const customGenerationId = customGenerationIdFromPage(input.page);
    const customLibraryResumeId = customLibraryResumeIdFromPage(input.page);
    const jobResumeAvailable = jobId
      ? await this.recommendedResume.existsForJob(input.applierName, jobId)
      : false;
    const customGeneratedAvailable = customGenerationId
      ? await this.customResumes.existsForGeneration(
          input.applierName,
          customGenerationId,
        )
      : false;
    const customLibraryAvailable = customLibraryResumeId
      ? await this.libraryResumes.exists(
          input.applierName,
          customLibraryResumeId,
        )
      : false;
    const customResumeAvailable =
      customGeneratedAvailable || customLibraryAvailable;
    const recommendedResumeAvailable =
      jobResumeAvailable || customResumeAvailable;

    if (
      !oakFillResumeSatisfied({
        isAdmin,
        jobResumeAvailable,
        customResumeAvailable,
        customRemembered: customRememberedFromPage(input.page),
      })
    ) {
      throw new ForbiddenException({
        success: false,
        code: OAK_FILL_RESUME_REQUIRED_CODE,
        error: OAK_FILL_RESUME_REQUIRED_MESSAGE,
        message: OAK_FILL_RESUME_REQUIRED_MESSAGE,
      });
    }

    return {
      isAdmin,
      recommendedResumeAvailable,
      page: withRecommendedResumeAvailable(
        input.page,
        recommendedResumeAvailable,
      ),
    };
  }

  applyPlanPolicy(plan: unknown, isAdmin: boolean): unknown {
    if (isAdmin) return plan;
    return applyActionTemperature(plan, OAK_NON_ADMIN_ACTION_TEMPERATURE);
  }
}
