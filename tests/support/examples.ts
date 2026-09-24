import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TargetPlatform } from '@runflux/compiler';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { ExportedProject, type ExportOptions } from './exported-project';
import { compile } from './workflows';

export const EXAMPLES_DIRECTORY = fileURLToPath(new URL('../../examples/', import.meta.url));

/** A `.runflux.json` file, as the editor exports and imports projects. */
export interface ExampleProject {
  readonly $schema?: string;
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly project: { readonly name: string; readonly envVars?: ReadonlyArray<{ key: string; value: string; description?: string }> };
  readonly workflow: WorkflowDefinition;
}

export async function exampleFiles(): Promise<string[]> {
  return (await fs.readdir(EXAMPLES_DIRECTORY)).filter((file) => file.endsWith('.runflux.json')).sort();
}

export async function loadExample(name: string): Promise<ExampleProject> {
  return JSON.parse(await fs.readFile(`${EXAMPLES_DIRECTORY}${name}.runflux.json`, 'utf8'));
}

/** The workflow as the editor compiles it: with the project's variables in its settings. */
export function workflowOf(example: ExampleProject): WorkflowDefinition {
  return { ...example.workflow, settings: { ...example.workflow.settings, envVars: [...(example.project.envVars ?? [])] } };
}

/** Compiles, writes and builds the example's backend, as a user would after downloading it. */
export async function buildExample(example: ExampleProject, target: TargetPlatform, options?: ExportOptions): Promise<ExportedProject> {
  const project = await ExportedProject.write(await compile(workflowOf(example), target, example.project.name), options);
  return project.build();
}

export function nodeIds(example: ExampleProject, pluginId?: string): string[] {
  return example.workflow.nodes.filter((node) => !pluginId || node.pluginId === pluginId).map((node) => node.id);
}
