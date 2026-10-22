import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ResumeLibraryCatalogService } from '../../resumes/resume-library-catalog.service';
import { ResumeService } from '../../resumes/resume.service';
import {
  assignedResumeId,
  assignedResumeStack,
  type OakRecommendAssignment,
} from './oak-recommended-resume.resolve';

@Injectable()
export class OakRecommendedResumeLookup {
  constructor(
    private readonly resumes: ResumeService,
    private readonly libraryCatalog: ResumeLibraryCatalogService,
  ) {}

  /**
   * Prefer the Library row Job Search assigned to this job.
   * Fall back to that job's stack label only when the stored id is gone.
   * Never substitute a different stack, primary resume, or runtime file.
   */
  async resolveId(
    profileId: string,
    ownerName: string,
    recommend: OakRecommendAssignment,
  ): Promise<string> {
    const assignedId = assignedResumeId(recommend);
    if (assignedId) {
      const owned = await this.ownedResumeId(assignedId, ownerName);
      if (owned) return owned;
    }

    const stack = assignedResumeStack(recommend);
    const byStack = stack
      ? await this.libraryCatalog.findIdByStack(profileId, stack)
      : null;
    if (byStack) return byStack;

    throw new NotFoundException({
      success: false,
      error: 'No recommended Library resume for this job',
    });
  }

  private async ownedResumeId(
    resumeId: string,
    ownerName: string,
  ): Promise<string | null> {
    try {
      const row = await this.resumes.findOwned(resumeId, ownerName);
      return row.id;
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        return null;
      }
      throw err;
    }
  }
}
