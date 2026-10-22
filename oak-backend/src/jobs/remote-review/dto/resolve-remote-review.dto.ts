import { IsIn, IsString } from 'class-validator';
import { JOB_REMOTE_VALUES } from '../../constants/job-remote.constants';

export class ResolveRemoteReviewDto {
  @IsString()
  id!: string;

  @IsIn([...JOB_REMOTE_VALUES])
  remote!: (typeof JOB_REMOTE_VALUES)[number];
}
