import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import type { ProjectEnvVar } from '@runflux/workflow-model/schema';
import type { WorkflowPersistenceAdapter } from './workflow-persistence-adapter';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  currentWorkflowVersion: string | null;
  nodeCount: number;
}

export type { ProjectEnvVar } from '@runflux/workflow-model/schema';

export interface ProjectDetail {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  currentWorkflowVersion: string | null;
  envVars?: ProjectEnvVar[];
  workflow: WorkflowDefinition;
}

export interface RunfluxExportEnvelope {
  $schema?: string;
  schemaVersion: 1;
  exportedAt: string;
  project: {
    name: string;
    envVars?: ProjectEnvVar[];
  };
  workflow: WorkflowDefinition;
}

export class ProjectApiError extends Error {
  status: number;
  code: string;

  constructor(
    status: number,
    code: string,
    message: string
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ProjectApiError';
  }
}

export class HttpProjectApiAdapter implements WorkflowPersistenceAdapter {
  private readonly baseUrl: string;

  constructor(baseUrl: string = '/api/projects') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      let code = 'UNKNOWN_ERROR';
      let message = `Request to ${url} failed with status ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) {
          code = body.error.code || code;
          message = body.error.message || message;
        }
      } catch {
        // fallback to generic message
      }
      throw new ProjectApiError(res.status, code, message);
    }

    if (res.status === 204) {
      return undefined as unknown as T;
    }

    return res.json() as Promise<T>;
  }

  async listProjects(options: { archived?: boolean; search?: string } = {}): Promise<ProjectSummary[]> {
    const params = new URLSearchParams();
    if (options.archived) params.set('archived', 'true');
    if (options.search) params.set('search', options.search);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<ProjectSummary[]>(query);
  }

  async getProject(id: string): Promise<ProjectDetail> {
    return this.request<ProjectDetail>(`/${id}`);
  }

  async createProject(data: { name: string; definition?: WorkflowDefinition }): Promise<ProjectDetail> {
    return this.request<ProjectDetail>('', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProject(id: string, data: { name?: string; definition?: WorkflowDefinition }): Promise<ProjectDetail> {
    return this.request<ProjectDetail>(`/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async archiveProject(id: string): Promise<{ id: string; archivedAt: string; status: 'archived' }> {
    return this.request<{ id: string; archivedAt: string; status: 'archived' }>(`/${id}/archive`, {
      method: 'POST',
    });
  }

  async restoreProject(id: string): Promise<{ id: string; archivedAt: null; status: 'active' }> {
    return this.request<{ id: string; archivedAt: null; status: 'active' }>(`/${id}/restore`, {
      method: 'POST',
    });
  }

  async deletePermanently(id: string): Promise<void> {
    return this.request<void>(`/${id}`, {
      method: 'DELETE',
    });
  }

  async exportProject(id: string): Promise<RunfluxExportEnvelope> {
    return this.request<RunfluxExportEnvelope>(`/${id}/export`);
  }

  async importProject(envelope: RunfluxExportEnvelope): Promise<ProjectDetail> {
    return this.request<ProjectDetail>('/import', {
      method: 'POST',
      body: JSON.stringify(envelope),
    });
  }

  async save(workflow: WorkflowDefinition): Promise<void> {
    if (workflow.id) {
      try {
        await this.updateProject(workflow.id, { name: workflow.name, definition: workflow });
        return;
      } catch (err) {
        if (err instanceof ProjectApiError && err.status === 404) {
          await this.createProject({ name: workflow.name, definition: workflow });
          return;
        }
        throw err;
      }
    }
    await this.createProject({ name: workflow.name, definition: workflow });
  }

  async load(workflowId: string): Promise<WorkflowDefinition | undefined> {
    try {
      const detail = await this.getProject(workflowId);
      return detail.workflow;
    } catch (err) {
      if (err instanceof ProjectApiError && err.status === 404) {
        return undefined;
      }
      throw err;
    }
  }

  async getEnvVars(projectId: string): Promise<ProjectEnvVar[]> {
    const res = await this.request<{ envVars: ProjectEnvVar[] }>(`/${projectId}/env`);
    return res.envVars || [];
  }

  async updateEnvVars(projectId: string, envVars: ProjectEnvVar[]): Promise<ProjectEnvVar[]> {
    const res = await this.request<{ envVars: ProjectEnvVar[] }>(`/${projectId}/env`, {
      method: 'PUT',
      body: JSON.stringify({ envVars }),
    });
    return res.envVars || [];
  }
}
