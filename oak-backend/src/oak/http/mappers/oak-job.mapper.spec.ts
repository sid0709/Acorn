import { mapOakWorkerJob } from './oak-job.mapper';

describe('mapOakWorkerJob', () => {
  it('exposes the stored Job.description as jobDescription', () => {
    const mapped = mapOakWorkerJob(
      {
        id: 'job1',
        title: 'Staff engineer',
        companyName: 'Acme',
        applyLink: 'https://jobs.example/1',
        description: '  Build the platform.  ',
        metadata: {},
      },
      { workerPoolAt: null },
    );
    expect(mapped.jobDescription).toBe('Build the platform.');
    expect(mapped.hasJobDescription).toBe(true);
  });

  it('marks missing stored JD without inventing text', () => {
    const mapped = mapOakWorkerJob(
      {
        id: 'job1',
        title: 'Staff engineer',
        companyName: 'Acme',
        applyLink: null,
        description: null,
        metadata: {},
      },
      { workerPoolAt: null },
    );
    expect(mapped.jobDescription).toBe('');
    expect(mapped.hasJobDescription).toBe(false);
  });
});
