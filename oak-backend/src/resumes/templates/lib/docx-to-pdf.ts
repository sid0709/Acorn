import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileExists, runWithCandidates } from './office-bin';

/** Convert a DOCX buffer to PDF via LibreOffice (soffice). */
export async function convertDocxToPdf(buffer: Buffer): Promise<Buffer> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'athens-docx-pdf-'));
  const profileDir = path.join(tmpDir, 'lo-profile');
  try {
    const docxPath = path.join(tmpDir, 'resume.docx');
    await writeFile(docxPath, buffer);
    await runWithCandidates('soffice', [
      '--headless',
      '--norestore',
      '--nodefault',
      '--nolockcheck',
      '--nofirststartwizard',
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--convert-to',
      'pdf',
      '--outdir',
      tmpDir,
      docxPath,
    ]);
    const pdfPath = path.join(tmpDir, 'resume.pdf');
    if (!(await fileExists(pdfPath))) {
      throw new Error('DOCX conversion did not produce a PDF.');
    }
    return readFile(pdfPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
