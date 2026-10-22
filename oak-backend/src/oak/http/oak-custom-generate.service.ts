import { BadRequestException, Injectable } from '@nestjs/common';
import { ResumeGenerateContinueService } from '../../resumes/generator/resume-generate-continue.service';
import { ResumeGenerateEnqueueService } from '../../resumes/generator/resume-generate-enqueue.service';
import { ResumeGenerationTaskService } from '../../resumes/generator/resume-generation-task.service';
import { cleanString } from '../../resumes/generator/lib/clean-string';
import type { OakPublicSession } from '../auth/oak-session.service';

@Injectable()
export class OakCustomGenerateService {
  constructor(
    private readonly enqueue: ResumeGenerateEnqueueService,
    private readonly continueRun: ResumeGenerateContinueService,
    private readonly tasks: ResumeGenerationTaskService,
  ) {}

  /** Extracted posting prose as JD — stored Editor config/template, same as POST /personal/resume-generate. */
  async enqueueForSession(session: OakPublicSession, jobDescription: unknown) {
    const description = cleanString(jobDescription);
    if (!description) {
      throw new BadRequestException({
        success: false,
        error: 'jobDescription is required',
      });
    }
    const queued = (await this.enqueue.enqueue({
      applierName: session.applierName,
      profileId: session.profileId,
      jobDescription: description,
    })) as { inputId?: unknown; task?: unknown };
    const inputId = cleanString(queued.inputId);
    if (!inputId) {
      throw new BadRequestException({
        success: false,
        error: 'Resume generation did not return an input id',
      });
    }
    return {
      ok: true as const,
      mode: 'custom' as const,
      inputId,
      jobDescription: description,
      task: queued.task ?? null,
    };
  }

  pollForSession(session: OakPublicSession, inputId: string) {
    return this.tasks.get(inputId, session.applierName);
  }

  continueForSession(session: OakPublicSession, inputId: string) {
    return this.continueRun.continue({
      inputId,
      applierName: session.applierName,
    });
  }
}
