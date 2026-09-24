import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { WorkflowCompiler } from '../compiler.js';
import { createZipPackage } from '../packager.js';
import { BuildProfile } from '../project/build-profile.js';
import type { DeploymentTarget } from '../targets/deployment-target.js';
import type { CompilationRequest } from '../types.js';
import { resolveFixture } from './fixtures/plugins.js';
import { edge, node, workflow } from './fixtures/workflows.js';

const clock = () => new Date('2026-01-01T12:00:00.000Z');
const compiler = new WorkflowCompiler(resolveFixture, { clock });
const request = (overrides: Partial<CompilationRequest> = {}): CompilationRequest => ({
  workflow: workflow([node('hook', 'webhook'), node('echo', 'echo')], [edge('hook', 'echo')]),
  targetPlatform: 'local',
  projectName: 'Orders',
  ...overrides,
});

describe('WorkflowCompiler', () => {
  it.each(['local', 'aws'] as const)('produces a %s project with its manifest, runtime and zip', async (targetPlatform) => {
    const result = await compiler.compile(request({ targetPlatform, projectVersion: 'v3' }));
    if (result.status !== 'success') throw new Error(result.error.message);
    const paths = result.files.map((file) => file.path);
    expect(paths[0]).toBe('runflux-build.json');
    expect(paths).toEqual(expect.arrayContaining(['src/workflow.json', 'vendor/runflux-runtime/plugins.js', 'vendor/runflux-runtime/index.js']));
    expect(result.manifest).toEqual({
      runfluxVersion: '0.1.0',
      targetPlatform,
      workflowId: 'fixture',
      projectName: 'Orders',
      workflowVersion: 'v3',
      compiledAt: '2026-01-01T12:00:00.000Z',
      entrypoint: targetPlatform === 'local' ? 'src/server.ts' : 'src/handler.ts',
      build: targetPlatform === 'local'
        ? { entryPoints: ['src/server.ts', 'src/run.ts'], bundleDependencies: false }
        : { entryPoints: ['src/handler.ts'], bundleDependencies: true },
      nodeCount: 2,
      pluginVersions: { webhook: '1.0.0', echo: '1.0.0' },
      generatedFiles: paths.slice(1),
    });
    expect(JSON.parse(result.files[0].content)).toEqual(result.manifest);
    const zip = await JSZip.loadAsync(await createZipPackage(result.files));
    expect(Object.keys(zip.files).filter((path) => !path.endsWith('/')).sort()).toEqual([...paths].sort());
  });

  it('leaves the plugins dependencies and the hosts packages out of the runtime bundle', async () => {
    const result = await compiler.compile(request({ workflow: workflow([node('hook', 'webhook'), node('save', 'store')]) }));
    if (result.status !== 'success') throw new Error(result.error.message);
    const express = result.files.find((file) => file.path === 'vendor/runflux-runtime/express.js')!;
    expect(express.content).toMatch(/from "express"/);
  });

  it('ships only runtime hosts used by a local workflow', async () => {
    const withoutSchedule = await compiler.compile(request());
    if (withoutSchedule.status !== 'success') throw new Error(withoutSchedule.error.message);
    const withoutSchedulePaths = withoutSchedule.files.map((file) => file.path);
    expect(withoutSchedulePaths).toContain('vendor/runflux-runtime/express.js');
    expect(withoutSchedulePaths).toContain('vendor/runflux-runtime/cli.js');
    expect(withoutSchedulePaths).not.toContain('vendor/runflux-runtime/cron.js');

    const withSchedule = await compiler.compile(request({ workflow: workflow([node('hourly', 'schedule')]) }));
    if (withSchedule.status !== 'success') throw new Error(withSchedule.error.message);
    expect(withSchedule.files.map((file) => file.path)).toContain('vendor/runflux-runtime/cron.js');
  });

  it('can omit the local CLI from production-focused exports', async () => {
    const result = await compiler.compile(request({ options: { includeCli: false } }));
    if (result.status !== 'success') throw new Error(result.error.message);
    const paths = result.files.map((file) => file.path);
    expect(paths).not.toContain('src/run.ts');
    expect(paths).not.toContain('vendor/runflux-runtime/cli.js');
    expect(result.manifest.build.entryPoints).toEqual(['src/server.ts']);
    expect(JSON.parse(result.files.find((file) => file.path === 'package.json')!.content).scripts.run).toBeUndefined();
  });

  it.each<[string, Partial<CompilationRequest>, string]>([
    ['incompatible nodes', { targetPlatform: 'aws', workflow: workflow([node('a', 'localOnly')]) }, 'INCOMPATIBLE_NODES'],
    ['an unsupported target', { targetPlatform: 'gcp' as never }, 'UNSUPPORTED_TARGET'],
    ['a workflow without node list', { workflow: { ...workflow([]), nodes: 'none' as never } }, 'INVALID_WORKFLOW'],
    ['a node with list parameters', { workflow: workflow([{ ...node('a', 'echo'), parameters: [] as never }]) }, 'INVALID_WORKFLOW'],
    ['cycles', { workflow: workflow([node('a', 'echo'), node('b', 'echo')], [edge('a', 'b'), edge('b', 'a')]) }, 'CYCLE_DETECTED'],
    ['invalid references', { workflow: workflow([node('a', 'echo')], [edge('a', 'ghost')]) }, 'INVALID_WORKFLOW'],
    ['invalid trigger configuration', { workflow: workflow([node('a', 'failingDeployment')]) }, 'INVALID_WORKFLOW'],
    ['schedules AWS cannot express', { targetPlatform: 'aws', workflow: workflow([node('a', 'schedule', { expression: '0 0 1 * 1' })]) }, 'INVALID_WORKFLOW'],
    ['plugins contradicting the hosts dependencies', { workflow: workflow([node('a', 'expressPinned')]) }, 'INVALID_WORKFLOW'],
    ['runtimes that cannot be bundled', { workflow: workflow([node('a', 'broken')]) }, 'GENERATOR_ERROR'],
    ['runtimes importing editor packages', { workflow: workflow([node('a', 'editorOnly')]) }, 'GENERATOR_ERROR'],
  ])('reports %s as a failed result', async (_case, overrides, code) => {
    expect(await compiler.compile(request(overrides))).toMatchObject({ status: 'failed', error: { code } });
  });

  it('uses the targets it is given and rethrows their unexpected errors', async () => {
    const custom: DeploymentTarget = {
      platform: 'local',
      entrypoint: 'custom.txt',
      runtimeEntries: () => [],
      hostPackages: () => [],
      buildProfile: () => BuildProfile.server(['custom.txt']),
      files: async () => [{ path: 'custom.txt', content: 'custom', type: 'asset' }],
    };
    const result = await new WorkflowCompiler(resolveFixture, { clock, targets: { local: custom } }).compile(request());
    if (result.status !== 'success') throw new Error(result.error.message);
    expect(result.files.map((file) => file.path)).toContain('custom.txt');
    expect(result.manifest).toMatchObject({ entrypoint: 'custom.txt', build: { entryPoints: ['custom.txt'] } });

    const crashing = { ...custom, files: async () => { throw new Error('target crashed'); } };
    await expect(new WorkflowCompiler(resolveFixture, { targets: { local: crashing } }).compile(request())).rejects.toThrow('target crashed');
  });
});
