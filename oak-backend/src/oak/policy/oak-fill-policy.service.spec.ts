import { ForbiddenException } from '@nestjs/common';
import { OAK_FILL_RESUME_REQUIRED_CODE } from '../constants/oak-admin.constants';
import { OakFillPolicyService } from './oak-fill-policy.service';

jest.mock('../http/oak-custom-resume.service', () => ({
  OakCustomResumeService: class OakCustomResumeService {},
}));
jest.mock('../http/oak-custom-library-resume.service', () => ({
  OakCustomLibraryResumeService: class OakCustomLibraryResumeService {},
}));
jest.mock('../http/oak-recommended-resume.service', () => ({
  OakRecommendedResumeService: class OakRecommendedResumeService {},
}));
jest.mock('./oak-admin-privileges.service', () => ({
  OakAdminPrivilegesService: class OakAdminPrivilegesService {},
}));

function service(opts: {
  isAdmin: boolean;
  jobResume?: boolean;
  customResume?: boolean;
  libraryResume?: boolean;
}) {
  const admin = { isAdmin: async () => opts.isAdmin };
  const recommendedResume = {
    existsForJob: async () => Boolean(opts.jobResume),
  };
  const customResume = {
    existsForGeneration: async () => Boolean(opts.customResume),
  };
  const libraryResume = {
    exists: () => Promise.resolve(Boolean(opts.libraryResume)),
  };
  return new OakFillPolicyService(
    admin as never,
    recommendedResume as never,
    customResume as never,
    libraryResume as never,
  );
}

describe('OakFillPolicyService', () => {
  it('allows a Worker Pool job resume', async () => {
    const policy = await service({
      isAdmin: false,
      jobResume: true,
    }).resolveForAnalyze({
      applierName: 'robin',
      page: { job: { id: 'job-1' } },
    });
    expect(policy.recommendedResumeAvailable).toBe(true);
    expect(policy.page.recommendedResumeAvailable).toBe(true);
  });

  it('allows an owned Custom generation', async () => {
    const policy = await service({
      isAdmin: false,
      customResume: true,
    }).resolveForAnalyze({
      applierName: 'robin',
      page: { customGenerationId: 'gen-1' },
    });
    expect(policy.recommendedResumeAvailable).toBe(true);
  });

  it('allows a Custom Library recommend', async () => {
    const policy = await service({
      isAdmin: false,
      libraryResume: true,
    }).resolveForAnalyze({
      applierName: 'robin',
      page: { customLibraryResumeId: 'lib-1' },
    });
    expect(policy.recommendedResumeAvailable).toBe(true);
  });

  it('forbids non-admin fill with neither resume', async () => {
    await expect(
      service({ isAdmin: false }).resolveForAnalyze({
        applierName: 'robin',
        page: {},
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service({ isAdmin: false }).resolveForAnalyze({
        applierName: 'robin',
        page: {},
      }),
    ).rejects.toMatchObject({
      response: { code: OAK_FILL_RESUME_REQUIRED_CODE },
    });
  });

  it('allows Custom remembered fill without a generated résumé', async () => {
    const policy = await service({ isAdmin: false }).resolveForAnalyze({
      applierName: 'robin',
      page: { customRemembered: true },
    });
    expect(policy.recommendedResumeAvailable).toBe(false);
  });

  it('allows admin fill without a resume', async () => {
    const policy = await service({ isAdmin: true }).resolveForAnalyze({
      applierName: 'admin',
      page: {},
    });
    expect(policy.isAdmin).toBe(true);
    expect(policy.recommendedResumeAvailable).toBe(false);
  });
});
