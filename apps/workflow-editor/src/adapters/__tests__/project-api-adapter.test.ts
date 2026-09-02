import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpProjectApiAdapter, ProjectApiError } from '../project-api-adapter';

describe('HttpProjectApiAdapter', () => {
  const adapter = new HttpProjectApiAdapter('/api/projects');

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists active projects and passes query params', async () => {
    const mockProjects = [{ id: 'p1', name: 'Fluxo 1', nodeCount: 3 }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockProjects,
    }));

    const result = await adapter.listProjects({ archived: true, search: 'teste' });
    expect(result).toEqual(mockProjects);
    expect(fetch).toHaveBeenCalledWith('/api/projects?archived=true&search=teste', expect.anything());
  });

  it('creates project with POST', async () => {
    const newProject = { id: 'p2', name: 'Criado' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => newProject,
    }));

    const result = await adapter.createProject({ name: 'Criado' });
    expect(result).toEqual(newProject);
    expect(fetch).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Criado' }),
      })
    );
  });

  it('throws ProjectApiError on 409 conflict with error details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: {
          code: 'PROJECT_NAME_CONFLICT',
          message: 'Nome duplicado',
        },
      }),
    }));

    await expect(adapter.createProject({ name: 'Existente' })).rejects.toThrow(ProjectApiError);
  });

  it('archives, restores and deletes projects with respective endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'p1', archivedAt: '2026-09-02T00:00:00Z', status: 'archived' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'p1', archivedAt: null, status: 'active' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
      })
    );

    const archived = await adapter.archiveProject('p1');
    expect(archived.status).toBe('archived');

    const restored = await adapter.restoreProject('p1');
    expect(restored.status).toBe('active');

    await expect(adapter.deletePermanently('p1')).resolves.toBeUndefined();
  });
});
