import { resumeUploadName } from './resume-file-name';

describe('resumeUploadName', () => {
  it('uses the profile name and keeps the file type', () => {
    expect(resumeUploadName('Eli Taylor', 'Backend.pdf')).toBe(
      'Eli Taylor.pdf',
    );
    expect(resumeUploadName('Eli Taylor', 'Frontend.DOCX')).toBe(
      'Eli Taylor.docx',
    );
  });

  it('falls back to pdf when the file has no extension', () => {
    expect(resumeUploadName('Eli Taylor', 'resume')).toBe('Eli Taylor.pdf');
  });

  it('keeps the original name when the profile has none', () => {
    expect(resumeUploadName('  ', 'folder/Backend.pdf')).toBe('Backend.pdf');
  });

  it('removes characters a file name cannot hold', () => {
    expect(resumeUploadName('Eli "E" / Taylor', 'a.pdf')).toBe(
      'Eli E Taylor.pdf',
    );
  });
});
