import {
  customGenerationIdFromPage,
  customLibraryResumeIdFromPage,
  customRememberedFromPage,
  jobIdFromPage,
} from './analyze-page';

describe('jobIdFromPage', () => {
  it('reads a trimmed job id', () => {
    expect(jobIdFromPage({ job: { id: '  abc  ' } })).toBe('abc');
  });

  it('returns null without a job id', () => {
    expect(jobIdFromPage(null)).toBeNull();
    expect(jobIdFromPage({ job: { title: 'x' } })).toBeNull();
    expect(jobIdFromPage({ job: { id: '' } })).toBeNull();
    expect(jobIdFromPage({ job: 'x' })).toBeNull();
  });
});

describe('customGenerationIdFromPage', () => {
  it('reads a trimmed custom generation id', () => {
    expect(customGenerationIdFromPage({ customGenerationId: '  gen1  ' })).toBe(
      'gen1',
    );
  });

  it('returns null when missing', () => {
    expect(customGenerationIdFromPage({ job: { id: 'job1' } })).toBeNull();
    expect(customGenerationIdFromPage(null)).toBeNull();
    expect(customGenerationIdFromPage({})).toBeNull();
    expect(customGenerationIdFromPage({ customGenerationId: 1 })).toBeNull();
  });
});

describe('customLibraryResumeIdFromPage', () => {
  it('reads a trimmed Library résumé id', () => {
    expect(
      customLibraryResumeIdFromPage({ customLibraryResumeId: '  lib1  ' }),
    ).toBe('lib1');
  });

  it('returns null when missing', () => {
    expect(
      customLibraryResumeIdFromPage({ customGenerationId: 'gen1' }),
    ).toBeNull();
    expect(customLibraryResumeIdFromPage(null)).toBeNull();
    expect(customLibraryResumeIdFromPage({})).toBeNull();
    expect(
      customLibraryResumeIdFromPage({ customLibraryResumeId: 1 }),
    ).toBeNull();
  });
});

describe('customRememberedFromPage', () => {
  it('is true only for the Custom remembered flag', () => {
    expect(customRememberedFromPage({ customRemembered: true })).toBe(true);
    expect(customRememberedFromPage({ customRemembered: false })).toBe(false);
    expect(customRememberedFromPage({})).toBe(false);
    expect(customRememberedFromPage(null)).toBe(false);
  });
});
