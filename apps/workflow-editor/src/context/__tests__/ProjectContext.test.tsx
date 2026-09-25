import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectApi, ProjectDetail } from '../../adapters/project-api-adapter';
import { useWorkflowStore } from '../../store/workflow-store';
import { ProjectProvider, useProject } from '../ProjectContext';

const detail: ProjectDetail = {
  id: 'p1', name: 'Orders', createdAt: '', updatedAt: '', archivedAt: null, currentWorkflowVersion: 'v1', envVars: [],
  workflow: { id: 'p1', name: 'Orders', nodes: [], connections: [] },
};

function fakeApi(overrides: Partial<ProjectApi> = {}): ProjectApi {
  return {
    listProjects: vi.fn(async () => []),
    getProject: vi.fn(async () => detail),
    createProject: vi.fn(async () => detail),
    updateProject: vi.fn(async () => detail),
    archiveProject: vi.fn(async () => ({ id: 'p1', archivedAt: 'now', status: 'archived' as const })),
    restoreProject: vi.fn(async () => ({ id: 'p1', archivedAt: null, status: 'active' as const })),
    deletePermanently: vi.fn(async () => {}),
    exportProject: vi.fn(),
    importProject: vi.fn(async () => detail),
    updateEnvVars: vi.fn(async (_id, envVars) => envVars),
    ...overrides,
  };
}

function session(api: ProjectApi) {
  const wrapper = ({ children }: { children: ReactNode }) => <ProjectProvider adapter={api}>{children}</ProjectProvider>;
  return renderHook(() => useProject(), { wrapper });
}

describe('ProjectProvider', () => {
  it('shows the failure of an action, rethrows it and clears it on the next success', async () => {
    const getProject = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(detail);
    const { result } = session(fakeApi({ getProject }));
    await act(async () => { await expect(result.current.openProject('p1')).rejects.toThrow('offline'); });
    expect([result.current.error, result.current.isLoading]).toEqual(['offline', false]);
    await act(async () => { await result.current.openProject('p1'); });
    expect([result.current.error, result.current.isLoading, result.current.currentProject?.id]).toEqual([null, false, 'p1']);
  });

  it('uses the action fallback message when a failure has none', async () => {
    const { result } = session(fakeApi({ archiveProject: vi.fn().mockRejectedValue({}) }));
    await act(async () => { await expect(result.current.archiveProject('p1')).rejects.toEqual({}); });
    expect(result.current.error).toBe('Falha ao arquivar projeto');
  });

  it('is clean right after opening a project and dirty after the workflow changes', async () => {
    const { result } = session(fakeApi());
    await act(async () => { await result.current.openProject('p1'); });
    expect(result.current.isDirty).toBe(false);
    act(() => { useWorkflowStore.getState().addNode({ id: 'n', pluginId: 'set', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }); });
    await waitFor(() => expect(result.current.isDirty).toBe(true));
  });
});
