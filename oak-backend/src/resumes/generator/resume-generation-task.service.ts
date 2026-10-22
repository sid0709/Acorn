import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { cleanString } from './lib/clean-string';
import { mapGenerationTaskBody } from './mappers/generation-task.mapper';

@Injectable()
export class ResumeGenerationTaskService {
  constructor(private readonly prisma: PrismaService) {}

  async get(inputIdRaw: string, applierNameRaw?: string) {
    const inputId = cleanString(inputIdRaw);
    const input = await this.prisma.backgroundTaskInput.findUnique({
      where: { id: inputId },
    });
    if (!input) {
      throw new NotFoundException({
        success: false,
        error: 'Resume generation input not found',
      });
    }

    const applierName = cleanString(applierNameRaw);
    if (
      applierName &&
      applierName.toLocaleLowerCase('en-US') !==
        String(input.applierName || '').toLocaleLowerCase('en-US')
    ) {
      throw new ForbiddenException({
        success: false,
        error: 'Resume generation access denied',
      });
    }

    return mapGenerationTaskBody(input);
  }
}
