import { Injectable } from '@nestjs/common';
import type { Resume, Prisma } from '@prisma/client';
import type { ProfileLlmAuth } from '../ai/auth/profile-llm-auth.service';
import { AiChatWithUsageService } from '../ai-usage/ai-chat-with-usage.service';
import { AI_USAGE_FEATURES } from '../ai-usage/constants/ai-usage.constants';
import { RESUME_SKILL_ANALYSIS_PROMPT } from './analyze/resume-skill-analysis.prompt';
import { parseSkillProfileJson } from './analyze/resume-skill-parse';
import { RESUME_ANALYZE_TEXT_MAX_CHARS } from './constants/resume-skill.constants';
import { parentJobIdFromAnalysis } from './lib/parent-job-id';
import type { ResumeAnalysisObject } from './mappers/resume.mapper';
import { ResumeWriteService } from './resume-write.service';

export type ResumeAnalyzeItemResult = {
  resumeId: string;
  status: 'completed' | 'failed' | 'skipped';
  alreadyAnalyzed?: boolean;
  skillCount?: number;
  error?: string;
};

@Injectable()
export class ResumeAnalyzeProcessService {
  constructor(
    private readonly chat: AiChatWithUsageService,
    private readonly writes: ResumeWriteService,
  ) {}

  async analyzeOne(input: {
    resume: Resume;
    auth: ProfileLlmAuth;
    force: boolean;
    signal?: AbortSignal;
  }): Promise<ResumeAnalyzeItemResult> {
    const { resume, auth, force, signal } = input;

    if (resume.analyzed && !force) {
      return {
        resumeId: resume.id,
        status: 'skipped',
        alreadyAnalyzed: true,
        skillCount: skillCountOf(resume),
      };
    }

    const text = String(resume.extractedText || '').trim();
    if (!text) {
      const message = 'No extracted text available for analysis';
      await this.writes.update(resume.id, {
        analysisError: message,
        analyzed: false,
      });
      return { resumeId: resume.id, status: 'failed', error: message };
    }

    const truncated = text.slice(0, RESUME_ANALYZE_TEXT_MAX_CHARS);

    try {
      const result = await this.chat.chatCompletion({
        apiKey: auth.apiKey,
        model: auth.model,
        provider: auth.provider,
        jsonMode: true,
        signal,
        messages: [
          { role: 'system', content: RESUME_SKILL_ANALYSIS_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              fileName: resume.fileName,
              title: resume.title,
              resumeText: truncated,
            }),
          },
        ],
        usageMeta: {
          feature: AI_USAGE_FEATURES.resumeAnalyze,
          applierName: auth.applierName,
          path: '/resumes/analyze',
        },
      });

      const skills = parseSkillProfileJson(result.content);
      if (!skills.length) {
        const message = 'Model returned no skills';
        await this.writes.update(resume.id, {
          analysisError: message,
          analyzed: false,
        });
        return { resumeId: resume.id, status: 'failed', error: message };
      }

      const analysis = mergeSkillAnalysis(resume, {
        skills,
        provider: auth.provider,
        model: auth.model,
        usage: result.usage ?? null,
      }) as Prisma.InputJsonValue;

      await this.writes.update(resume.id, {
        analyzed: true,
        analyzedAt: new Date(),
        analysis,
        analysisError: null,
      });

      return {
        resumeId: resume.id,
        status: 'completed',
        skillCount: skills.length,
      };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      const message = err instanceof Error ? err.message : String(err);
      await this.writes.update(resume.id, { analysisError: message });
      return { resumeId: resume.id, status: 'failed', error: message };
    }
  }
}

function skillCountOf(resume: Resume): number {
  const a = resume.analysis;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 0;
  const skills = (a as ResumeAnalysisObject).skills;
  return Array.isArray(skills) ? skills.length : 0;
}

function mergeSkillAnalysis(
  resume: Resume,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const prior =
    resume.analysis &&
    typeof resume.analysis === 'object' &&
    !Array.isArray(resume.analysis)
      ? (resume.analysis as Record<string, unknown>)
      : {};
  const parent =
    String(resume.parentJobId || '').trim() || parentJobIdFromAnalysis(prior);
  return {
    ...prior,
    ...next,
    ...(parent ? { generateParentJobId: parent } : {}),
  };
}
