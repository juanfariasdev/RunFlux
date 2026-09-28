import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import type { EnvVarUpdate, ProjectEnvVarView } from '@runflux/workflow-model/schema';
import { ProjectApiError } from './api-error';
import { authorizedFetch, bindFetch, type FetchFunction } from './authorized-fetch';
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

export type { EnvVarUpdate, ProjectEnvVar, ProjectEnvVarView } from '@runflux/workflow-model/schema';
export { ProjectApiError } from './api-error';

export interface ProjectDetail {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  currentWorkflowVersion: string | null;
  /** Whether each variable has a value, never the value (feature 015, RN-07). */
  envVars?: ProjectEnvVarView[];
  workflow: WorkflowDefinition;
}

export interface RunfluxExportEnvelope {
  $schema?: string;
  schemaVersion: 1;
  exportedAt: string;
  project: {
    name: string;
    /** Names and descriptions; files exported before feature 015 also carry values, which import seals. */
    envVars?: Array<{ key: string; value?: string; description?: string }>;
  };
  workflow: WorkflowDefinition;
}

/** What the project session (ProjectContext) needs from the project server. */
export interface ProjectApi {
  listProjects(options?: { archived?: boolean; search?: string }): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<ProjectDetail>;
  createProject(data: { name: string; definition?: WorkflowDefinition }): Promise<ProjectDetail>;
  updateProject(id: string, data: { name?: string; definition?: WorkflowDefinition }): Promise<ProjectDetail>;
  archiveProject(id: string): Promise<{ id: string; archivedAt: string; status: 'archived' }>;
  restoreProject(id: string): Promise<{ id: string; archivedAt: null; status: 'active' }>;
  deletePermanently(id: string): Promise<void>;
  exportProject(id: string): Promise<RunfluxExportEnvelope>;
  importProject(envelope: RunfluxExportEnvelope): Promise<ProjectDetail>;
  /** Sends the whole list; a variable without `value` keeps its stored one. */
  updateEnvVars(projectId: string, updates: EnvVarUpdate[]): Promise<ProjectEnvVarView[]>;
}

export class HttpProjectApiAdapter implements ProjectApi, WorkflowPersistenceAdapter {
  private readonly baseUrl: string;
  private readonly send: FetchFunction;

  /** `send` defaults to the editor's `authorizedFetch`, which adds the platform token (D-14). */
  constructor(baseUrl: string = '/api/projects', send: FetchFunction = authorizedFetch) {
    this.baseUrl = baseUrl;
    this.send = bindFetch(send);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const res = await this.send(url, { ...options, headers });
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

  async getEnvVars(projectId: string): Promise<ProjectEnvVarView[]> {
    const res = await this.request<{ envVars: ProjectEnvVarView[] }>(`/${projectId}/env`);
    return res.envVars || [];
  }

  async updateEnvVars(projectId: string, updates: EnvVarUpdate[]): Promise<ProjectEnvVarView[]> {
    const res = await this.request<{ envVars: ProjectEnvVarView[] }>(`/${projectId}/env`, {
      method: 'PUT',
      body: JSON.stringify({ envVars: updates }),
    });
    return res.envVars || [];
  }
}
