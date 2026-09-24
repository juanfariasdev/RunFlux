import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plugins } from '../plugins.js';
import { ConsoleLogger, SystemClock, createRuntimeServices } from '../services/default-services.js';
import { ServiceKey, ServiceRegistry } from '../services/service-registry.js';
import { FetchHttpClient } from '../http/http-client.js';

afterEach(() => vi.restoreAllMocks());

describe('package boundaries', () => {
  it('keeps the core free of Node.js modules so the editor can bundle it for the browser', async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../index.ts', import.meta.url))],
      bundle: true,
      platform: 'browser',
      write: false,
      logLevel: 'silent',
      metafile: true,
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some((input) => input.includes('/hosts/') || input.startsWith('node:'))).toBe(false);
  });

  it('ships no plugins of its own; the compiler provides them per workflow', () => {
    expect(plugins).toEqual({});
  });
});

describe('ServiceRegistry', () => {
  it('stores services by the name of their key', () => {
    const registry = new ServiceRegistry().set(new ServiceKey<number>('answer'), 42);
    expect(registry.get(new ServiceKey<number>('answer'))).toBe(42);
    expect(registry.get(new ServiceKey<number>('other'))).toBeUndefined();
  });
});

describe('default services', () => {
  it('logs to the console and tells the current time', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    new ConsoleLogger().info('message', { detail: 1 });
    new ConsoleLogger().error('failure', 2);
    expect(log).toHaveBeenCalledWith('message', { detail: 1 });
    expect(error).toHaveBeenCalledWith('failure', 2);
    expect(Math.abs(new SystemClock().now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('uses production defaults and honours overrides', () => {
    const defaults = createRuntimeServices();
    expect(defaults.http).toBeInstanceOf(FetchHttpClient);
    expect(defaults.logger).toBeInstanceOf(ConsoleLogger);
    expect(defaults.clock).toBeInstanceOf(SystemClock);
    expect(defaults.triggerEvents).toBeUndefined();
    const triggerEvents = { waitFor: async () => ({}) };
    expect(createRuntimeServices({ triggerEvents }).triggerEvents).toBe(triggerEvents);
  });
});
