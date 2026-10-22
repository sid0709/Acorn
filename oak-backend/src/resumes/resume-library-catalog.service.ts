import { Injectable } from '@nestjs/common';
import { compressResumeCatalog } from '../bids/lib/resume-catalog';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Build LLM catalog from analyzed My Resume's Library rows.
 * Stack label = Resume.title (folder name); skills = analysis.skills.
 */
@Injectable()
export class ResumeLibraryCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async compressForProfile(profileId: string): Promise<{
    text: string;
    stackNames: string[];
  }> {
    const rows = await this.prisma.resume.findMany({
      where: { profileId, analyzed: true },
      select: {
        title: true,
        analysis: true,
        analyzedAt: true,
        uploadedAt: true,
      },
      orderBy: [{ analyzedAt: 'desc' }, { uploadedAt: 'desc' }],
    });

    const catalog: Record<string, Array<{ name: string }>> = {};
    for (const row of rows) {
      const title = String(row.title || '').trim();
      if (!title || catalog[title]) continue;
      catalog[title] = skillEntriesFromAnalysis(row.analysis);
    }

    return compressResumeCatalog(catalog);
  }

  /** Newest analyzed Library file whose stack label (title) matches. */
  async findIdByStack(
    profileId: string,
    stack: string,
  ): Promise<string | null> {
    const id = String(profileId || '').trim();
    const title = String(stack || '').trim();
    if (!id || !title) return null;

    const row = await this.prisma.resume.findFirst({
      where: { profileId: id, title, analyzed: true },
      orderBy: [{ analyzedAt: 'desc' }, { uploadedAt: 'desc' }],
      select: { id: true },
    });
    return row?.id ?? null;
  }
}

function skillEntriesFromAnalysis(analysis: unknown): Array<{ name: string }> {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    return [];
  }
  const skills = (analysis as { skills?: unknown }).skills;
  if (!Array.isArray(skills)) return [];
  const out: Array<{ name: string }> = [];
  const seen = new Set<string>();
  for (const item of skills) {
    const name =
      typeof item === 'string'
        ? item.trim()
        : item &&
            typeof item === 'object' &&
            typeof (item as { name?: string }).name === 'string'
          ? String((item as { name: string }).name).trim()
          : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name });
  }
  return out;
}
