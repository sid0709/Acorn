import { backgroundWorkersMode } from './task-types';

describe('backgroundWorkersMode', () => {
  it('treats split as API-only so the probe path is used', () => {
    expect(backgroundWorkersMode({ BACKGROUND_WORKERS_MODE: 'split' })).toBe(
      'off',
    );
    expect(backgroundWorkersMode({ BACKGROUND_WORKERS_MODE: 'off' })).toBe(
      'off',
    );
  });

  it('keeps the dedicated worker process in worker mode', () => {
    expect(backgroundWorkersMode({ BACKGROUND_WORKERS_MODE: 'worker' })).toBe(
      'worker',
    );
  });

  it('defaults local runs to embedded', () => {
    expect(backgroundWorkersMode({})).toBe('embedded');
  });
});
