import { describe, it, expect } from 'vitest';
import { generators } from '../index';

describe('trigger-cron generators', () => {
  it('generates valid local code file', () => {
    const artifact = generators.local({ expression: '*/5 * * * *', timezone: 'UTC' }, {} as any);
    expect(artifact.files).toHaveLength(1);
    expect(artifact.files[0].path).toBe('trigger-cron.ts');
    expect(artifact.files[0].content).toContain('CRON_EXPRESSION = "*/5 * * * *"');
    expect(artifact.files[0].content).toContain('CRON_TIMEZONE = "UTC"');
    expect(artifact.files[0].content).toContain('export function run');
  });

  it('generates valid aws code file matching local behavior', () => {
    const artifact = generators.aws({ expression: '0 * * * *', timezone: 'UTC' }, {} as any);
    expect(artifact.files).toHaveLength(1);
    expect(artifact.files[0].path).toBe('trigger-cron.ts');
    expect(artifact.files[0].content).toContain('CRON_EXPRESSION = "0 * * * *"');
  });
});
