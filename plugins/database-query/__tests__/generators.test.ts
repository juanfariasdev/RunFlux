import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadGeneratedModule } from '@runflux/plugin-system/testing';
import { generators } from '../index.js';

afterEach(() => vi.unstubAllEnvs());
describe('database-query generated backend', () => {
  it.each(['local', 'aws'])('%s binds query parameters and returns the selected result shape', async (platform) => {
    vi.stubEnv('CUSTOM_DB_URL', 'postgres://localhost/test');
    const query = vi.fn(async () => ({ rows: [{ id: 7 }] }));
    const pg = { Pool: class { query = query; on() { return this; } } };
    for (const outputMode of ['all', 'first']) {
      const artifact = generators[platform]({ connectionEnvVar: 'CUSTOM_DB_URL', query: 'SELECT id WHERE id = $1', queryParams: [7], outputMode }, { workflowId: 'test', nodeId: 'db' });
      expect(await loadGeneratedModule(artifact.files[0].content, { pg }).run({}, {})).toEqual(outputMode === 'first' ? { id: 7 } : [{ id: 7 }]);
    }
    expect(query).toHaveBeenCalledWith('SELECT id WHERE id = $1', [7]);
  });
});
