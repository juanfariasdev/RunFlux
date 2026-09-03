import { describe, it, expect } from 'vitest';
import { generators } from '../index';

describe('trigger-webhook generators', () => {
  it('generates valid local code file with path, method and auth configuration', () => {
    const artifact = generators.local({ path: '/api/v1/webhook', httpMethod: 'POST', auth: 'secret' }, {} as any);
    expect(artifact.files).toHaveLength(1);
    expect(artifact.files[0].path).toBe('trigger-webhook.ts');
    expect(artifact.files[0].content).toContain('WEBHOOK_PATH = "/api/v1/webhook"');
    expect(artifact.files[0].content).toContain('WEBHOOK_METHOD = "POST"');
    expect(artifact.files[0].content).toContain('WEBHOOK_AUTH = "secret"');
  });

  it('generates valid aws code file matching local behavior', () => {
    const artifact = generators.aws({ path: '/orders', httpMethod: 'PUT' }, {} as any);
    expect(artifact.files).toHaveLength(1);
    expect(artifact.files[0].path).toBe('trigger-webhook.ts');
    expect(artifact.files[0].content).toContain('WEBHOOK_PATH = "/orders"');
    expect(artifact.files[0].content).toContain('WEBHOOK_METHOD = "PUT"');
  });
});
