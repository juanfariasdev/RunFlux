import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { ConfigurationError } from '../errors.js';
import { isLoopbackAddress, isLoopbackHost } from '../security/loopback.js';

const TOKEN = 't'.repeat(32);

function configurationError(env: NodeJS.ProcessEnv): ConfigurationError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigurationError) return error;
    throw error;
  }
  throw new Error('loadConfig accepted the settings');
}

describe('loadConfig', () => {
  it('listens on loopback, with a 5 MB body limit, no origins and no token, by default', () => {
    expect(loadConfig({})).toEqual({ port: 3001, host: '127.0.0.1', corsOrigins: [], bodyLimit: '5mb' });
  });

  it('reads the host, the token, the origins and the body limit', () => {
    const config = loadConfig({
      HOST: '0.0.0.0',
      RUNFLUX_API_TOKEN: TOKEN,
      RUNFLUX_CORS_ORIGINS: ' https://a.example , ,https://b.example ',
      RUNFLUX_BODY_LIMIT: '10mb',
    });
    expect(config).toMatchObject({ host: '0.0.0.0', apiToken: TOKEN, corsOrigins: ['https://a.example', 'https://b.example'], bodyLimit: '10mb' });
  });

  it('refuses to be exposed without a token, and treats an empty token as missing', () => {
    for (const env of [{ HOST: '0.0.0.0' }, { HOST: '192.168.1.10', RUNFLUX_API_TOKEN: '' }]) {
      const error = configurationError(env);
      expect(error.variable).toBe('RUNFLUX_API_TOKEN');
      expect(error.message).toContain('RUNFLUX_API_TOKEN');
    }
  });

  it('refuses a token shorter than 32 characters, even on loopback', () => {
    expect(configurationError({ RUNFLUX_API_TOKEN: 't'.repeat(31) }).variable).toBe('RUNFLUX_API_TOKEN');
    expect(loadConfig({ RUNFLUX_API_TOKEN: TOKEN }).apiToken).toBe(TOKEN);
  });

  it('keeps a loopback HOST without asking for a token', () => {
    expect(loadConfig({ HOST: 'localhost' }).host).toBe('localhost');
  });

  it('refuses a body limit that is not a size', () => {
    expect(configurationError({ RUNFLUX_BODY_LIMIT: 'lots' }).variable).toBe('RUNFLUX_BODY_LIMIT');
  });
});

describe('loopback', () => {
  it('knows the loopback hosts', () => {
    for (const host of ['localhost', '::1', '127.0.0.1', '127.0.0.5']) expect(isLoopbackHost(host), host).toBe(true);
    for (const host of ['0.0.0.0', '::', '192.168.1.10', 'example.com', '128.0.0.1']) expect(isLoopbackHost(host), host).toBe(false);
  });

  it('knows the loopback remote addresses, IPv4-mapped ones included', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(address), address).toBe(true);
    for (const address of [undefined, '192.168.1.10', '::ffff:192.168.1.10']) expect(isLoopbackAddress(address), String(address)).toBe(false);
  });
});
