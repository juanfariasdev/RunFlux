import type { WorkflowDefinition } from '@runflux/workflow-model';
import { envVarsArraySchema, runfluxEnvelopeSchema, workflowDefinitionSchema, type ProjectEnvVar } from '@runflux/workflow-model/schema';
import { DomainError } from '../errors.js';
import { ProjectRepository } from '../repositories/project-repository.js';

export class ProjectConflictError extends DomainError {
  constructor(message: string) {
    super('PROJECT_NAME_CONFLICT', 409, message);
  }
}

export class ProjectNotFoundError extends DomainError {
  constructor(message: string) {
    super('PROJECT_NOT_FOUND', 404, message);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super('INVALID_PAYLOAD', 400, message);
  }
}

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Old projects stored database-query.connectionEnvVar as a bare environment-variable name.
 * The editor-facing representation is an explicit $env expression, so normalize legacy projects
 * both when they are read and before a new workflow version is persisted.
 */
function normalizeWorkflowDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      if (node.pluginId !== 'database-query') return node;
      const value = node.parameters?.connectionEnvVar;
      if (typeof value !== 'string' || !ENVIRONMENT_VARIABLE_NAME.test(value.trim())) return node;
      return {
        ...node,
        parameters: { ...node.parameters, connectionEnvVar: `{{$env.${value.trim()}}}` },
      };
    }),
  };
}

export class ProjectService {
  constructor(private readonly repo: ProjectRepository) {}

  async createProject(data: { name: string; definition?: WorkflowDefinition; envVars?: ProjectEnvVar[] }) {
    const trimmedName = requireName(data.name);
    await this.assertNameAvailable(trimmedName);

    const project = await this.repo.create({
      name: trimmedName,
      currentWorkflowVersion: data.definition ? 'v1' : undefined,
    });

    if (data.envVars && data.envVars.length > 0) {
      const validatedEnv = envVarsArraySchema.parse(data.envVars);
      await this.repo.update(project.id, {
        envVars: JSON.stringify(validatedEnv),
      });
    }

    if (data.definition) {
      const validated = validDefinition(data.definition);
      await this.repo.createVersion({
        projectId: project.id,
        version: 'v1',
        definition: JSON.stringify(validated),
      });
    }

    return this.getProject(project.id);
  }

  async listProjects(options: { archived?: boolean; search?: string } = {}) {
    const projects = await this.repo.findMany(options);
    return projects.map((p) => {
      let nodeCount = 0;
      if (p.versions.length > 0) {
        try {
          const parsed = JSON.parse(p.versions[0].definition) as WorkflowDefinition;
          nodeCount = parsed.nodes?.length || 0;
        } catch {
          nodeCount = 0;
        }
      }

      return {
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        archivedAt: p.archivedAt,
        currentWorkflowVersion: p.currentWorkflowVersion,
        nodeCount,
      };
    });
  }

  async getProject(id: string) {
    const project = await this.requireProject(id);

    let workflow: WorkflowDefinition = {
      id: project.id,
      name: project.name,
      nodes: [],
      connections: [],
    };

    if (project.versions.length > 0) {
      try {
        const parsed = JSON.parse(project.versions[0].definition);
        workflow = normalizeWorkflowDefinition({
          ...parsed,
          id: project.id,
          name: project.name,
        });
      } catch {
        // se houver falha de parse, retorna default
      }
    }

    const envVars = parseEnvVars(project.envVars);

    return {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      archivedAt: project.archivedAt,
      currentWorkflowVersion: project.currentWorkflowVersion,
      envVars,
      workflow,
    };
  }

  async updateProject(id: string, data: { name?: string; definition?: WorkflowDefinition }) {
    const project = await this.requireProject(id);

    let updatedName = project.name;
    if (data.name !== undefined) {
      const trimmed = requireName(data.name);
      if (trimmed !== project.name) await this.assertNameAvailable(trimmed, id);
      updatedName = trimmed;
    }

    let nextVersion = project.currentWorkflowVersion;
    if (data.definition !== undefined) {
      const validated = validDefinition(data.definition);
      nextVersion = nextVersionLabel(await this.repo.getLatestVersion(id));

      await this.repo.createVersion({
        projectId: id,
        version: nextVersion,
        definition: JSON.stringify(validated),
      });
    }

    await this.repo.update(id, {
      name: updatedName,
      currentWorkflowVersion: nextVersion || undefined,
    });

    return this.getProject(id);
  }

  async archiveProject(id: string) {
    await this.requireProject(id);
    return this.repo.archive(id);
  }

  async restoreProject(id: string) {
    const project = await this.requireProject(id);

    const collision = await this.repo.findByName(project.name, false);
    if (collision && collision.id !== id) {
      const uniqueName = await this.generateUniqueName(project.name);
      await this.repo.update(id, { name: uniqueName });
    }

    return this.repo.restore(id);
  }

  async deletePermanently(id: string) {
    await this.requireProject(id);
    return this.repo.hardDelete(id);
  }

  async getProjectEnv(id: string): Promise<ProjectEnvVar[]> {
    const project = await this.requireProject(id);
    return parseEnvVars(project.envVars);
  }

  async updateProjectEnv(id: string, envVars: unknown): Promise<ProjectEnvVar[]> {
    await this.requireProject(id);

    const validated = envVarsArraySchema.parse(envVars);
    await this.repo.update(id, {
      envVars: JSON.stringify(validated),
    });

    return validated;
  }

  async exportProject(id: string) {
    const projectWithWf = await this.getProject(id);
    return {
      $schema: 'https://runflux.dev/schemas/v1/workflow-project.json',
      schemaVersion: 1 as const,
      exportedAt: new Date().toISOString(),
      project: {
        name: projectWithWf.name,
        envVars: projectWithWf.envVars,
      },
      workflow: projectWithWf.workflow,
    };
  }

  async importProject(payload: unknown) {
    const parsed = runfluxEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ValidationError(`Arquivo de importação inválido: ${parsed.error.message}`);
    }

    const { project: projectData, workflow: workflowData } = parsed.data;
    const finalName = await this.generateUniqueName(projectData.name);

    return this.createProject({
      name: finalName,
      envVars: projectData.envVars,
      definition: {
        id: '',
        name: finalName,
        nodes: workflowData.nodes as any,
        connections: workflowData.connections as any,
      },
    });
  }

  private async requireProject(id: string) {
    const project = await this.repo.findById(id);
    if (!project) throw new ProjectNotFoundError(`Projeto '${id}' não encontrado`);
    return project;
  }

  /** Rejects a name another active project uses; `ownerId` is the project allowed to keep it. */
  private async assertNameAvailable(name: string, ownerId?: string): Promise<void> {
    const existing = await this.repo.findByName(name, false);
    if (existing && existing.id !== ownerId) throw new ProjectConflictError(`Já existe um projeto ativo com o nome '${name}'`);
  }

  private async generateUniqueName(baseName: string): Promise<string> {
    const existing = await this.repo.findByName(baseName, false);
    if (!existing) {
      return baseName;
    }

    const matches = await this.repo.findByNamePrefix(baseName);
    const existingNames = new Set(matches.map((m) => m.name));

    let counter = 1;
    let candidate = `${baseName} (${counter})`;
    while (existingNames.has(candidate)) {
      counter++;
      candidate = `${baseName} (${counter})`;
    }

    return candidate;
  }
}

/** A project name, trimmed; blank or missing names are rejected. */
function requireName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw new ValidationError('Nome do projeto não pode ser vazio');
  return trimmed;
}

/** A workflow as it is stored: legacy parameters normalized, then validated. */
function validDefinition(definition: WorkflowDefinition) {
  return workflowDefinitionSchema.parse(normalizeWorkflowDefinition(definition));
}

/** The label after the latest version: `v1` first, then the next number after `vN`. */
function nextVersionLabel(latest: { version: string } | null): string {
  const current = latest?.version.startsWith('v') ? parseInt(latest.version.substring(1), 10) : Number.NaN;
  return `v${Number.isNaN(current) ? 1 : current + 1}`;
}

/** The stored variables of a project; missing or unreadable ones are an empty list. */
function parseEnvVars(stored: string | null): ProjectEnvVar[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
