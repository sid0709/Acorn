import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertDocxToPdf } from './docx-to-pdf';
import { runWithCandidates } from './office-bin';

const PREVIEW_DPI =
  Number.parseInt(process.env.RESUME_TEMPLATE_PREVIEW_DPI || '144', 10) || 144;

export type ResumeTemplatePreviewPage = {
  mimeType: string;
  dataBase64: string;
  width: number;
  height: number;
};

function pngSize(buffer: Buffer): { width: number; height: number } {
  if (
    buffer.length >= 24 &&
    buffer.toString('ascii', 1, 4) === 'PNG' &&
    buffer.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return { width: 0, height: 0 };
}

export async function renderDocxPreviewImages(
  buffer: Buffer,
): Promise<ResumeTemplatePreviewPage[]> {
  const pdf = await convertDocxToPdf(buffer);
  const tmpDir = await mkdtemp(
    path.join(os.tmpdir(), 'athens-resume-preview-'),
  );
  try {
    const pdfPath = path.join(tmpDir, 'resume.pdf');
    await writeFile(pdfPath, pdf);
    const prefix = path.join(tmpDir, 'page');
    await runWithCandidates('pdftoppm', [
      '-png',
      '-r',
      String(PREVIEW_DPI),
      pdfPath,
      prefix,
    ]);
    const files = (await readdir(tmpDir))
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort(
        (a, b) =>
          Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0),
      );
    const pages: ResumeTemplatePreviewPage[] = [];
    for (const file of files) {
      const png = await readFile(path.join(tmpDir, file));
      const { width, height } = pngSize(png);
      pages.push({
        mimeType: 'image/png',
        dataBase64: png.toString('base64'),
        width,
        height,
      });
    }
    if (!pages.length) {
      throw new Error('DOCX preview conversion did not produce page images.');
    }
    return pages;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
