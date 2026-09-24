import { describe, expect, it } from 'vitest';
import { projectEnvironment } from '../project-environment';

describe('projectEnvironment', () => {
  it('maps each variable name to its value, empty text when it has none', () => {
    expect(projectEnvironment([{ key: 'API_KEY', value: 'k' }, { key: 'EMPTY', value: undefined as never }, { key: '', value: 'ignored' }])).toEqual({ API_KEY: 'k', EMPTY: '' });
  });

  it('is empty without variables', () => {
    expect(projectEnvironment()).toEqual({});
    expect(projectEnvironment([])).toEqual({});
  });
});
