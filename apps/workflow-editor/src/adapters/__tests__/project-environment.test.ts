import { describe, expect, it } from 'vitest';
import { MASKED_VALUE, projectEnvironment } from '../project-environment';

/** Previews see a mask, never a value (feature 015, RN-12, RF-12). */
describe('projectEnvironment', () => {
  it('maps a variable with a value to the mask and one without to empty text', () => {
    expect(projectEnvironment([
      { key: 'API_KEY', hasValue: true },
      { key: 'EMPTY', hasValue: false },
      { key: 'OLD', hasValue: true, unreadable: true },
      { key: '', hasValue: true },
    ])).toEqual({ API_KEY: MASKED_VALUE, EMPTY: '', OLD: MASKED_VALUE });
    expect(MASKED_VALUE).toBe('••••••');
  });

  it('is empty without variables', () => {
    expect(projectEnvironment()).toEqual({});
    expect(projectEnvironment([])).toEqual({});
  });
});
