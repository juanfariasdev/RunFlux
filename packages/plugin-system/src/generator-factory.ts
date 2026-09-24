import type { GeneratorFn, PluginManifest, WorkflowContext } from './types.js';

/** A platform-neutral node only declares its logic; supported targets come from its manifest. */
export function createCodeGenerators(
  manifest: Pick<PluginManifest, 'id' | 'supportedPlatforms'>,
  render: (config: Record<string, unknown>, context: WorkflowContext) => string,
): Record<string, GeneratorFn> {
  const generate: GeneratorFn = (config, context) => ({
    files: [{ path: `${manifest.id}.ts`, content: render(config, context) }],
    infra: [],
  });
  return Object.fromEntries(manifest.supportedPlatforms.map((platform) => [platform, generate]));
}
