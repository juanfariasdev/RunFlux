import type { PluginManifest } from '@runflux/plugin-system';
import type { CompiledPlugin, PluginResolver } from '../../types.js';

const runtime = (name: string) => new URL(`./runtimes/${name}.ts`, import.meta.url);

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
  return { id, name: id, category: 'action', version: '1.0.0', parameters: [], supportedPlatforms: ['local', 'aws'], ...overrides };
}

/** Plugins with every kind of deployment contribution, running the echo runtime. */
export const fixturePlugins: Record<string, CompiledPlugin> = {
  webhook: {
    manifest: manifest('webhook', { category: 'trigger' }),
    runtimeModule: runtime('echo'),
    deployment: {
      triggers: (parameters) => [{
        kind: 'http',
        path: parameters.string('path', '/hook'),
        method: 'POST',
        rawBody: false,
        authentication: parameters.optionalString('secret')
          ? { type: 'header', headerName: 'X-Key', secretEnvVar: parameters.requiredString('secret') }
          : { type: 'none' },
      }],
      environment: (parameters) => (parameters.optionalString('secret') ? [{ key: parameters.requiredString('secret'), description: 'Webhook secret' }] : []),
    },
  },
  schedule: {
    manifest: manifest('schedule', { category: 'trigger' }),
    runtimeModule: runtime('echo'),
    deployment: { triggers: (parameters) => [{ kind: 'schedule', expression: parameters.string('expression', '0 * * * *'), timezone: 'UTC' }] },
  },
  store: {
    manifest: manifest('store', { parameters: [{ name: 'sql', label: 'SQL', type: 'string', required: true, expressions: false }] }),
    runtimeModule: runtime('echo'),
    deployment: {
      dependencies: { 'fixture-driver': '^1.0.0' },
      devDependencies: { '@types/fixture-driver': '^1.0.0' },
      environment: () => [{ key: 'STORE_URL', description: 'Store connection' }],
      compose: { services: { store: { image: 'store:1', ports: ['7000:7000'], volumes: ['data:/data'] } }, volumes: ['data'] },
    },
  },
  storeV2: { manifest: manifest('storeV2'), runtimeModule: runtime('echo'), deployment: { dependencies: { 'fixture-driver': '^2.0.0' } } },
  otherStore: { manifest: manifest('otherStore'), runtimeModule: runtime('echo'), deployment: { compose: { services: { store: { image: 'other:1' } } } } },
  sameStore: { manifest: manifest('sameStore'), runtimeModule: runtime('echo'), deployment: { compose: { services: { store: { image: 'store:1', ports: ['7000:7000'], volumes: ['data:/data'] } } } } },
  appService: { manifest: manifest('appService'), runtimeModule: runtime('echo'), deployment: { compose: { services: { app: { image: 'app:1' } } } } },
  badVariable: { manifest: manifest('badVariable'), runtimeModule: runtime('echo'), deployment: { environment: () => [{ key: 'NOT VALID' }] } },
  defaulted: {
    manifest: manifest('defaulted', { category: 'trigger', parameters: [{ name: 'path', label: 'Path', type: 'string', required: false, default: '/from-manifest' }] }),
    runtimeModule: runtime('echo'),
    deployment: { triggers: (parameters) => [{ kind: 'http', path: parameters.requiredString('path'), method: 'GET', rawBody: false, authentication: { type: 'none' } }] },
  },
  expressPinned: { manifest: manifest('expressPinned'), runtimeModule: runtime('echo'), deployment: { dependencies: { express: '^3.0.0' } } },
  branch: { manifest: manifest('branch', { outputs: ['yes', 'no'] }), runtimeModule: runtime('echo') },
  echo: { manifest: manifest('echo'), runtimeModule: runtime('echo') },
  localOnly: { manifest: manifest('localOnly', { supportedPlatforms: ['local'] }), runtimeModule: runtime('echo') },
  editorOnly: { manifest: manifest('editorOnly', { category: 'trigger' }), runtimeModule: runtime('editor-only') },
  broken: { manifest: manifest('broken', { category: 'trigger' }), runtimeModule: runtime('broken') },
  failingDeployment: {
    manifest: manifest('failingDeployment', { category: 'trigger' }),
    runtimeModule: runtime('echo'),
    deployment: { triggers: (parameters) => { throw parameters.error('path', 'is not valid'); } },
  },
};

export const resolveFixture: PluginResolver = (id) => fixturePlugins[id];
