import { z } from 'zod';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { ProjectRepository } from '../repositories/project-repository.js';

export class ProjectConflictError extends Error {
  code = 'PROJECT_NAME_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'ProjectConflictError';
  }
}

export class ProjectNotFoundError extends Error {
  code = 'PROJECT_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'ProjectNotFoundError';
  }
}

export class ValidationError extends Error {
  code = 'INVALID_PAYLOAD';
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const workflowNodeSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  pluginVersion: z.string().optional().default('1.0.0'),
  parameters: z.record(z.unknown()).default({}),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  parentId: z.string().optional(),
  appearance: z
    .object({
      label: z.string().optional(),
      color: z.string().optional(),
      shape: z.enum(['card', 'rounded', 'pill', 'diamond', 'subflow']).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional(),
});

const workflowConnectionSchema = z.object({
  sourceNodeId: z.string(),
  sourceOutput: z.string().default('main'),
  targetNodeId: z.string(),
  targetInput: z.string().default('main'),
  label: z.string().optional(),
  animated: z.boolean().optional(),
  type: z.enum(['smoothstep', 'bezier', 'straight']).optional(),
  color: z.string().optional(),
});

export const workflowDefinitionSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  nodes: z.array(workflowNodeSchema).default([]),
  connections: z.array(workflowConnectionSchema).default([]),
});

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

export interface ProjectEnvVar {
  key: string;
  value: string;
  description?: string;
}

const envVarItemSchema = z.object({
  key: z
    .string()
    .min(1, 'Nome da variável não pode ser vazio')
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Nome da variável deve ser um identificador válido (ex: API_KEY)'),
  value: z.string().default(''),
  description: z.string().optional(),
});

const envVarsArraySchema = z.array(envVarItemSchema);

export const runfluxEnvelopeSchema = z.object({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  project: z.object({
    name: z.string().min(1, 'Nome do projeto é obrigatório'),
    envVars: envVarsArraySchema.optional(),
  }),
  workflow: workflowDefinitionSchema,
});

export class ProjectService {
  constructor(private readonly repo = new ProjectRepository()) {}

  async createProject(data: { name: string; definition?: WorkflowDefinition; envVars?: ProjectEnvVar[] }) {
    const trimmedName = typeof data.name === 'string' ? data.name.trim() : '';
    if (!trimmedName) {
      throw new ValidationError('Nome do projeto não pode ser vazio');
    }

    const existing = await this.repo.findByName(trimmedName, false);
    if (existing) {
      throw new ProjectConflictError(`Já existe um projeto ativo com o nome '${trimmedName}'`);
    }

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
      const validated = workflowDefinitionSchema.parse(normalizeWorkflowDefinition(data.definition));
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
    const project = await this.repo.findById(id);
    if (!project) {
      throw new ProjectNotFoundError(`Projeto '${id}' não encontrado`);
    }

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

    let envVars: ProjectEnvVar[] = [];
    if (project.envVars) {
      try {
        const parsed = JSON.parse(project.envVars);
        if (Array.isArray(parsed)) envVars = parsed;
      } catch {
        envVars = [];
      }
    }

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
    const project = await this.repo.findById(id);
    if (!project) {
      throw new ProjectNotFoundError(`Projeto '${id}' não encontrado`);
    }

    let updatedName = project.name;
    if (data.name !== undefined) {
      const trimmed = typeof data.name === 'string' ? data.name.trim() : '';
      if (!trimmed) {
        throw new ValidationError('Nome do projeto não pode ser vazio');
      }

      if (trimmed !== project.name) {
        const existing = await this.repo.findByName(trimmed, false);
        if (existing && existing.id !== id) {
          throw new ProjectConflictError(`Já existe um projeto ativo com o nome '${trimmed}'`);
        }
      }
      updatedName = trimmed;
    }

    let nextVersion = project.currentWorkflowVersion;
    if (data.definition !== undefined) {
      const validated = workflowDefinitionSchema.parse(normalizeWorkflowDefinition(data.definition));
      
      const latest = await this.repo.getLatestVersion(id);
      let versionNumber = 1;
      if (latest && latest.version.startsWith('v')) {
        const parsedNum = parseInt(latest.version.substring(1), 10);
        if (!isNaN(parsedNum)) {
          versionNumber = parsedNum + 1;
        }
      }
      nextVersion = `v${versionNumber}`;

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
    const project = await this.repo.findById(id);
    if (!project) {
      throw new ProjectNotFoundError(`Projeto '${id}' não encontrado`);
    }
    return this.repo.archive(id);
  }

  async restoreProject(id: string) {
    const project = await this.repo.findById(id);
    if (!project) {
      throw new ProjectNotFoundError(`Projeto '${id}' não encontrado`);
    }

    const collision = await this.repo.findByName(project.name, false);
    if (collision && collision.id !== id) {
      const uniqueName = await this.generateUniqueName(project.name);
      await this.repo.update(id, { name: uniqueName });
    }

    return this.repo.restore(id);
  }

  async deletePermanently(id: string) {
    const project = await this.repo.findById(id);
    if (!project) {
      throw new ProjectNotFoundError(`Projeto '${id}' não encontrado`);
    }
    return this.repo.hardDelete(id);
  }

  async getProjectEnv(id: string): Promise<ProjectEnvVar[]> {
    const project = await this.repo.findById(id);
    if (!project) {
      throw new ProjectNotFoundError(`Projeto '${id}' não encontrado`);
    }
    if (!project.envVars) return [];
    try {
      const parsed = JSON.parse(project.envVars);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async updateProjectEnv(id: string, envVars: unknown): Promise<ProjectEnvVar[]> {
    const project = await this.repo.findById(id);
    if (!project) {
      throw new ProjectNotFoundError(`Projeto '${id}' não encontrado`);
    }

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
