import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AuthModule } from '../auth/auth.module';
import { BackgroundTasksModule } from '../background-tasks/background-tasks.module';
import { FirebaseModule } from '../firebase/firebase.module';
import { AgentJobResumesController } from './agent-job-resumes.controller';
import { AgentJobResumesService } from './agent-job-resumes.service';
import { AgentJobResumeFileController } from './agent-job-resume-file.controller';
import { AgentJobResumeFileService } from './agent-job-resume-file.service';
import { ResumeAnalyzeController } from './resume-analyze.controller';
import { ResumeAnalyzeProcessService } from './resume-analyze-process.service';
import { ResumeAnalyzeSessionService } from './resume-analyze-session.service';
import { ResumeGenerateController } from './generator/resume-generate.controller';
import { ResumeGenerateEnqueueService } from './generator/resume-generate-enqueue.service';
import { ResumeGenerateContinueService } from './generator/resume-generate-continue.service';
import { ResumeGenerateFinalizeService } from './generator/resume-generate-finalize.service';
import { ResumeJobArtifactService } from './generator/resume-job-artifact.service';
import { ResumeGenerationLibraryService } from './generator/resume-generation-library.service';
import { ResumeJobDocxService } from './generator/resume-job-docx.service';
import { ResumeGenerateHydrateService } from './generator/resume-generate-hydrate.service';
import { ResumeGenerateJobSearchService } from './generator/resume-generate-job-search.service';
import { ResumeGeneratePipelineService } from './generator/resume-generate-pipeline.service';
import { ResumeGeneratePrepareService } from './generator/resume-generate-prepare.service';
import { ResumeGenerateWorkerService } from './generator/resume-generate-worker.service';
import { ResumeGenerationTaskService } from './generator/resume-generation-task.service';
import { ResumeGenerationsController } from './generator/resume-generations.controller';
import { ResumeGenerationsService } from './generator/resume-generations.service';
import { ResumeGeneratorController } from './generator/resume-generator.controller';
import { ResumeCoverageAnalyzeService } from './generator/resume-coverage-analyze.service';
import { ResumeGeneratorConfigService } from './generator/resume-generator-config.service';
import { ResumeExportController } from './generator/resume-export.controller';
import { ResumeExportDocxService } from './generator/resume-export-docx.service';
import { ResumeTemplateController } from './templates/resume-template.controller';
import { ResumeTemplateService } from './templates/resume-template.service';
import { ResumeTemplateWriteService } from './templates/resume-template-write.service';
import { ResumeStorageService } from './resume-storage.service';
import { ResumeTextService } from './resume-text.service';
import { ResumeUploadService } from './resume-upload.service';
import { ResumeWriteService } from './resume-write.service';
import { ResumeLibraryCatalogService } from './resume-library-catalog.service';
import { ResumeService } from './resume.service';
import { ResumesController } from './resumes.controller';

@Module({
  imports: [
    AuthModule,
    AiModule,
    AiUsageModule,
    FirebaseModule,
    forwardRef(() => BackgroundTasksModule),
  ],
  controllers: [
    ResumesController,
    ResumeAnalyzeController,
    AgentJobResumesController,
    AgentJobResumeFileController,
    ResumeGeneratorController,
    ResumeGenerateController,
    ResumeGenerationsController,
    ResumeExportController,
    ResumeTemplateController,
  ],
  providers: [
    ResumeService,
    ResumeWriteService,
    ResumeUploadService,
    ResumeStorageService,
    ResumeTextService,
    ResumeAnalyzeProcessService,
    ResumeAnalyzeSessionService,
    AgentJobResumesService,
    AgentJobResumeFileService,
    ResumeLibraryCatalogService,
    ResumeGeneratorConfigService,
    ResumeCoverageAnalyzeService,
    ResumeGenerateHydrateService,
    ResumeGeneratePrepareService,
    ResumeGeneratePipelineService,
    ResumeGenerateFinalizeService,
    ResumeJobDocxService,
    ResumeJobArtifactService,
    ResumeGenerationLibraryService,
    ResumeGenerateEnqueueService,
    ResumeGenerateContinueService,
    ResumeGenerationTaskService,
    ResumeGenerateJobSearchService,
    ResumeGenerateWorkerService,
    ResumeGenerationsService,
    ResumeExportDocxService,
    ResumeTemplateService,
    ResumeTemplateWriteService,
  ],
  exports: [
    ResumeService,
    ResumeAnalyzeSessionService,
    ResumeLibraryCatalogService,
    ResumeGenerateWorkerService,
    ResumeGenerationsService,
    ResumeGenerateEnqueueService,
    ResumeGenerateContinueService,
    ResumeGenerationTaskService,
    ResumeGenerationLibraryService,
    AgentJobResumesService,
    AgentJobResumeFileService,
  ],
})
export class ResumesModule {}
