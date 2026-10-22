import { oakFillResumeSatisfied } from './oak-fill-allowed';

describe('oakFillResumeSatisfied', () => {
  it('allows admins without a resume', () => {
    expect(
      oakFillResumeSatisfied({
        isAdmin: true,
        jobResumeAvailable: false,
        customResumeAvailable: false,
      }),
    ).toBe(true);
  });

  it('allows a Worker-pool job resume', () => {
    expect(
      oakFillResumeSatisfied({
        isAdmin: false,
        jobResumeAvailable: true,
        customResumeAvailable: false,
      }),
    ).toBe(true);
  });

  it('allows a Custom generated resume', () => {
    expect(
      oakFillResumeSatisfied({
        isAdmin: false,
        jobResumeAvailable: false,
        customResumeAvailable: true,
      }),
    ).toBe(true);
  });

  it('allows a remembered Custom tab without a résumé', () => {
    expect(
      oakFillResumeSatisfied({
        isAdmin: false,
        jobResumeAvailable: false,
        customResumeAvailable: false,
        customRemembered: true,
      }),
    ).toBe(true);
  });

  it('rejects non-admin fill with neither resume', () => {
    expect(
      oakFillResumeSatisfied({
        isAdmin: false,
        jobResumeAvailable: false,
        customResumeAvailable: false,
      }),
    ).toBe(false);
  });
});
