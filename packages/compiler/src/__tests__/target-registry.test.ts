import { describe, expect, it } from 'vitest';
import { WorkflowCompiler } from '../compiler.js';
import { BuildProfile } from '../project/build-profile.js';
import type { DeploymentTarget } from '../targets/deployment-target.js';
import { defaultTargets, TargetRegistry } from '../targets/target-registry.js';
import { resolveFixture } from './fixtures/plugins.js';
import { node, workflow } from './fixtures/workflows.js';

/** A platform RunFlux does not ship, added the way a target package would add one. */
const edge: DeploymentTarget = {
  platform: 'edge',
  entrypoint: 'worker.ts',
  runtimeEntries: () => [],
  hostPackages: () => [],
  buildProfile: () => BuildProfile.function(['worker.ts']),
  files: async () => [{ path: 'worker.ts', content: 'export {}', type: 'source' }],
};

describe('TargetRegistry', () => {
  it('ships the local and AWS targets, in that order', () => {
    expect(defaultTargets().platforms()).toEqual(['local', 'aws']);
  });

  it('lets a new platform compile without any change to the compiler', async () => {
    const targets = defaultTargets().register(edge);
    const echoOnEdge = (pluginId: string) => {
      const plugin = resolveFixture(pluginId);
      return plugin && { ...plugin, manifest: { ...plugin.manifest, supportedPlatforms: [...plugin.manifest.supportedPlatforms, 'edge'] } };
    };
    const result = await new WorkflowCompiler(echoOnEdge, { targets }).compile({ workflow: workflow([node('echo', 'echo')]), targetPlatform: 'edge', projectName: 'Edge' });
    if (result.status !== 'success') throw new Error(result.error.message);
    expect(result.manifest).toMatchObject({ targetPlatform: 'edge', entrypoint: 'worker.ts' });
    expect(result.files.map((file) => file.path)).toContain('worker.ts');
  });

  it('answers UNSUPPORTED_TARGET for a platform nobody registered, and refuses a platform twice', async () => {
    const result = await new WorkflowCompiler(resolveFixture, { targets: new TargetRegistry() }).compile({ workflow: workflow([]), targetPlatform: 'local', projectName: 'P' });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'UNSUPPORTED_TARGET' } });
    expect(() => defaultTargets().register(edge).register(edge)).toThrow('registered twice');
  });
});
