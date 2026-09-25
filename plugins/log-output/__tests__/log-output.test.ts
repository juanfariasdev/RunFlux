import { validateManifest } from '@runflux/plugin-system/sdk';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it, vi } from 'vitest';
import { manifest } from '../index';
import log from '../runtime';

const logger = () => ({ info: vi.fn(), error: vi.fn() });

describe('log-output', () => {
  it('declares a valid output manifest', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.category).toBe('output');
  });

  it('logs its input under its label and passes the same value through', async () => {
    const input = { nested: { a: 1 } };
    const services = { logger: logger() };
    const record = await executeNode(log, { parameters: { label: 'Invoice {{ $json.nested.a }}' }, input, services });
    expect(record.output).toBe(input);
    expect(services.logger.info).toHaveBeenCalledWith('[log-output] Invoice 1:', input);
  });

  it('uses the default label', async () => {
    const services = { logger: logger() };
    await executeNode(log, { input: 'x', services });
    expect(services.logger.info).toHaveBeenCalledWith('[log-output] Log:', 'x');
  });

  it('logs to the console by default', async () => {
    const console = vi.spyOn(globalThis.console, 'log').mockImplementation(() => {});
    await executeNode(log, { parameters: { label: 'Default' }, input: 1 });
    expect(console).toHaveBeenCalledWith('[log-output] Default:', 1);
    console.mockRestore();
  });

  it('rejects a label that is not text', async () => {
    expect((await executeNode(log, { parameters: { label: 42 }, pluginId: 'log-output' })).error).toBe('log-output: parameter "label" must be text');
  });
});
