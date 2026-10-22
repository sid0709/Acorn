import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JOB_OBJECT_ID_PATTERN } from '../../jobs/lib/normalize-job-ids';
import { JobRecommendFieldsService } from '../../jobs/recommend/job-recommend-fields.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentJobResumeFileService } from '../../resumes/agent-job-resume-file.service';
import { AgentJobResumesService } from '../../resumes/agent-job-resumes.service';
import { RESUME_DOCX_MIME } from '../../resumes/constants/agent-job-resume.constants';
import { docxBufferToPreviewHtml } from '../../resumes/lib/docx-preview-page';
import { looksLikeDocx } from '../../resumes/lib/looks-like-docx';
import { ResumeService } from '../../resumes/resume.service';
import { appLogger } from '../../common/logger/app-logger';
import { OAK_RECOMMENDED_RESUME_KEY } from '../constants/oak.constants';
import { OakRecommendedResumeLookup } from './oak-recommended-resume.lookup';
import {
  assignedResumeStack,
  type OakRecommendAssignment,
} from './oak-recommended-resume.resolve';

type ResumeSource = 'generated' | 'library';

type OakResumeFile = {
  success: true;
  jobId: string;
  resumeId: string;
  stack: string | null;
  source: ResumeSource;
  file: {
    key: string;
    name: string;
    mimeType: string;
    base64: string;
  };
};

@Injectable()
export class OakRecommendedResumeService {
  private readonly log = appLogger(OakRecommendedResumeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendFields: JobRecommendFieldsService,
    private readonly resumes: ResumeService,
    private readonly lookup: OakRecommendedResumeLookup,
    private readonly agentResumes: AgentJobResumesService,
    private readonly agentFiles: AgentJobResumeFileService,
  ) {}

  async getForJob(applierName: string, jobId: string): Promise<OakResumeFile> {
    const id = String(jobId || '').trim();
    if (!JOB_OBJECT_ID_PATTERN.test(id)) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid job id',
      });
    }

    const account = await this.requireWorkerPoolAccount(applierName, id);
    const generated = await this.tryGeneratedFile(account.name, id);
    if (generated) return generated;

    const recommend = await this.loadRecommend(account.name, id);
    const resumeId = await this.lookup.resolveId(
      account.id,
      account.name,
      recommend,
    );
    const detail = await this.resumes.get(resumeId, account.name);
    if (!detail.contentBase64) {
      throw new NotFoundException({
        success: false,
        error: 'Recommended resume file is missing from storage',
      });
    }

    const stack =
      String(detail.techStack || '').trim() ||
      assignedResumeStack(recommend) ||
      null;
    this.log.info(
      { jobId: id, resumeId: detail.id, source: 'library', stack },
      'oak resume file',
    );
    return toFile({
      jobId: id,
      resumeId: detail.id,
      stack,
      source: 'library',
      name: detail.fileName,
      mimeType: detail.mimeType || 'application/octet-stream',
      base64: detail.contentBase64,
    });
  }

  /** True when a generated job résumé or Recommend Library file is available. */
  async existsForJob(applierName: string, jobId: string): Promise<boolean> {
    const id = String(jobId || '').trim();
    if (!JOB_OBJECT_ID_PATTERN.test(id)) return false;
    try {
      const account = await this.requireWorkerPoolAccount(applierName, id);
      const generated = await this.agentResumes.findGeneratedForJob(
        account.name,
        id,
      );
      if (generated) return true;
      const recommend = await this.loadRecommend(account.name, id);
      const resumeId = await this.lookup.resolveId(
        account.id,
        account.name,
        recommend,
      );
      const row = await this.resumes.findOwned(resumeId, account.name);
      return Boolean(String(row.storagePath || '').trim());
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        return false;
      }
      throw err;
    }
  }

  /** HTML preview of the generated résumé, or the Library file assigned to the job. */
  async previewGenerated(applierName: string, jobId: string) {
    const assigned = await this.getForJob(applierName, jobId);
    const buffer = Buffer.from(assigned.file.base64, 'base64');
    if (!looksLikeDocx(assigned.file.mimeType, assigned.file.name)) {
      throw new BadRequestException({
        success: false,
        error:
          'Preview is available for Word résumés. Download the file instead.',
      });
    }
    const html = await docxBufferToPreviewHtml(buffer);
    return {
      success: true as const,
      jobId: assigned.jobId,
      html,
    };
  }

  private async tryGeneratedFile(
    applierName: string,
    jobId: string,
  ): Promise<OakResumeFile | null> {
    const row = await this.agentResumes.findGeneratedForJob(applierName, jobId);
    if (!row) return null;
    try {
      const { buffer, fileName } = await this.agentFiles.streamDocx(
        applierName,
        jobId,
      );
      this.log.info(
        { jobId, resumeId: row.id, source: 'generated' },
        'oak resume file',
      );
      return toFile({
        jobId,
        resumeId: row.id,
        stack: 'Generated',
        source: 'generated',
        name: fileName,
        mimeType: RESUME_DOCX_MIME,
        base64: buffer.toString('base64'),
      });
    } catch (err) {
      this.log.warn(
        {
          jobId,
          err: err instanceof Error ? err.message : String(err),
        },
        'generated resume file unavailable',
      );
      throw err;
    }
  }

  private async loadRecommend(
    applierName: string,
    jobId: string,
  ): Promise<OakRecommendAssignment> {
    const byJob = await this.recommendFields.loadForApplier(applierName, [
      jobId,
    ]);
    return byJob.get(jobId) || byJob.get(jobId.toLowerCase()) || null;
  }

  private async requireWorkerPoolAccount(applierName: string, jobId: string) {
    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true, name: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        error: 'Account not found',
      });
    }
    const status = await this.prisma.jobStatus.findFirst({
      where: { profileId: account.id, jobId, state: 'worker-pool' },
      select: { jobId: true },
    });
    if (!status) {
      throw new NotFoundException({
        success: false,
        error: 'Job is not in Worker pool',
      });
    }
    return account;
  }
}

function toFile(input: {
  jobId: string;
  resumeId: string;
  stack: string | null;
  source: ResumeSource;
  name: string;
  mimeType: string;
  base64: string;
}): OakResumeFile {
  return {
    success: true,
    jobId: input.jobId,
    resumeId: input.resumeId,
    stack: input.stack,
    source: input.source,
    file: {
      key: OAK_RECOMMENDED_RESUME_KEY,
      name: input.name,
      mimeType: input.mimeType,
      base64: input.base64,
    },
  };
}
