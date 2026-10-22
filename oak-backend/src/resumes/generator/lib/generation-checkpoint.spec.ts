import {
  markCheckpointFailure,
  nextIncompleteIndex,
  parseCheckpoint,
  recordCheckpointProgress,
} from './generation-checkpoint';

describe('generation checkpoint', () => {
  it('keeps steps 1–3 and continues at 4 after step 4 fails', () => {
    const outputs: Record<number, unknown> = {
      1: { summary: 'ok-1' },
      2: { skills: [{ items: ['TypeScript'] }] },
      3: {
        experiences: [{ company: 'Acme', bullets: ['Shipped the platform.'] }],
      },
    };
    let progress: unknown = {};
    for (const index of [1, 2, 3]) {
      progress = recordCheckpointProgress(progress, {
        phase: 'step-done',
        index,
        total: 5,
        name: `Step ${index}`,
        purpose:
          index === 1 ? 'summary' : index === 2 ? 'skills' : 'experience',
        kind: 'final',
        output: outputs[index],
        content: `ok-${index}`,
      });
    }
    progress = recordCheckpointProgress(progress, {
      phase: 'step-start',
      index: 4,
      total: 5,
      name: 'Step 4',
      purpose: 'experience',
      kind: 'refine',
    });
    progress = markCheckpointFailure(
      progress,
      {
        phase: 'step-start',
        index: 4,
        total: 5,
        name: 'Step 4',
        purpose: 'experience',
      },
      'model timeout',
    );

    const checkpoint = parseCheckpoint(progress);
    expect(checkpoint.completedIndexes).toEqual([1, 2, 3]);
    expect(checkpoint.failedStepIndex).toBe(4);
    expect(checkpoint.error).toBe('model timeout');
    expect(nextIncompleteIndex(checkpoint)).toBe(4);
    expect(checkpoint.sections.summary).toEqual({ summary: 'ok-1' });
    expect(checkpoint.sections.skills).toEqual({
      skills: [{ items: ['TypeScript'] }],
    });
    expect(checkpoint.sections.experience).toEqual({
      experiences: [{ company: 'Acme', bullets: ['Shipped the platform.'] }],
    });
  });

  it('does not drop earlier outputs when a later step starts', () => {
    const afterOne = recordCheckpointProgress(
      {},
      {
        phase: 'step-done',
        index: 1,
        total: 2,
        name: 'Summary',
        purpose: 'summary',
        kind: 'final',
        output: { summary: 'kept' },
      },
    );
    const afterTwoStart = recordCheckpointProgress(afterOne, {
      phase: 'step-start',
      index: 2,
      total: 2,
      name: 'Skills',
      purpose: 'skills',
    });
    expect(parseCheckpoint(afterTwoStart).sections.summary).toEqual({
      summary: 'kept',
    });
    expect(parseCheckpoint(afterTwoStart).completedIndexes).toEqual([1]);
  });
});
