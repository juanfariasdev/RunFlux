import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { runfluxEnvelopeSchema, workflowDefinitionSchema, type ProjectEnvVar } from '@runflux/workflow-model/schema';
import { ProjectService } from '../services/project-service.js';

export const EXAMPLES_DIRECTORY = fileURLToPath(new URL('../../../../examples/', import.meta.url));

export interface SeededExample {
  readonly file: string;
  readonly name: string;
  readonly projectId: string;
  /** `updated` when the stored workflow or variables differed from the example. */
  readonly action: 'created' | 'updated' | 'unchanged';
}

/**
 * Stores the example projects of `examples/` as projects of the editor. Running it again updates
 * a project whose workflow no longer matches its example (as a new version) and adds variables
 * the example gained, but keeps the values already configured in the project.
 */
export class ExampleSeeder {
  private readonly projects: ProjectService;
  private readonly directory: string;

  constructor(projects: ProjectService, directory = EXAMPLES_DIRECTORY) {
    this.projects = projects;
    this.directory = directory;
  }

  async seed(): Promise<SeededExample[]> {
    const files = (await fs.readdir(this.directory)).filter((file) => file.endsWith('.runflux.json')).sort();
    const seeded: SeededExample[] = [];
    for (const file of files) seeded.push(await this.seedFile(file));
    return seeded;
  }

  private async seedFile(file: string): Promise<SeededExample> {
    const parsed = runfluxEnvelopeSchema.safeParse(JSON.parse(await fs.readFile(path.join(this.directory, file), 'utf8')));
    if (!parsed.success) throw new Error(`${file} is not a RunFlux project file: ${parsed.error.message}`);
    const { project, workflow } = parsed.data;
    const definition = { id: '', name: project.name, nodes: workflow.nodes, connections: workflow.connections } as WorkflowDefinition;
    const envVars: ProjectEnvVar[] = project.envVars ?? [];

    const existing = (await this.projects.listProjects()).find((candidate) => candidate.name === project.name);
    if (!existing) {
      const created = await this.projects.createProject({ name: project.name, definition, envVars });
      return { file, name: project.name, projectId: created.id, action: 'created' };
    }

    const stored = await this.projects.getProject(existing.id);
    const workflowChanged = !sameWorkflow(stored.workflow, definition);
    const mergedVars = mergeVariables(stored.envVars, envVars);
    const variablesChanged = !isDeepStrictEqual(mergedVars, stored.envVars);
    if (workflowChanged) await this.projects.updateProject(existing.id, { definition });
    if (variablesChanged) await this.projects.updateProjectEnv(existing.id, mergedVars);
    return { file, name: project.name, projectId: existing.id, action: workflowChanged || variablesChanged ? 'updated' : 'unchanged' };
  }
}

/** Compares the nodes and connections as the service stores them. */
function sameWorkflow(stored: WorkflowDefinition, example: WorkflowDefinition): boolean {
  const normalized = workflowDefinitionSchema.parse(example);
  return isDeepStrictEqual(stored.nodes, normalized.nodes) && isDeepStrictEqual(stored.connections, normalized.connections);
}

/** The project's variables plus those only the example declares; configured values win. */
function mergeVariables(stored: readonly ProjectEnvVar[], example: readonly ProjectEnvVar[]): ProjectEnvVar[] {
  const byKey = new Map(stored.map((variable) => [variable.key, variable]));
  const merged = example.map((variable) => {
    const current = byKey.get(variable.key);
    return current ? { ...variable, value: current.value } : variable;
  });
  const exampleKeys = new Set(example.map((variable) => variable.key));
  return [...merged, ...stored.filter((variable) => !exampleKeys.has(variable.key))];
}
