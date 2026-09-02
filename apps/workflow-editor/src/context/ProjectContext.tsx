import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import {
  HttpProjectApiAdapter,
  type ProjectSummary,
  type ProjectDetail,
  type RunfluxExportEnvelope,
} from '../adapters/project-api-adapter';
import { useWorkflowStore } from '../store/workflow-store';

export interface ProjectContextValue {
  adapter: HttpProjectApiAdapter;
  currentProject: ProjectDetail | null;
  projects: ProjectSummary[];
  archivedProjects: ProjectSummary[];
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;
  refreshProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  createNewProject: (name: string) => Promise<ProjectDetail>;
  saveCurrentProject: () => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  restoreProject: (id: string) => Promise<void>;
  deleteProjectPermanently: (id: string) => Promise<void>;
  exportProject: (id?: string) => Promise<void>;
  importProjectFile: (file: File) => Promise<ProjectDetail>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const defaultAdapter = new HttpProjectApiAdapter();

export function ProjectProvider({
  children,
  adapter = defaultAdapter,
}: {
  children: React.ReactNode;
  adapter?: HttpProjectApiAdapter;
}) {
  const [currentProject, setCurrentProject] = useState<ProjectDetail | null>(null);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string>('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const workflow = useWorkflowStore((s) => s.workflow);
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);

  // Calcula se o grafo atual no canvas difere do último snapshot salvo
  const isDirty = useMemo(() => {
    if (!currentProject || !lastSavedSnapshot) return false;
    const currentJson = JSON.stringify({
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
    });
    return currentJson !== lastSavedSnapshot;
  }, [currentProject, lastSavedSnapshot, workflow]);

  const refreshProjects = useCallback(async () => {
    try {
      setError(null);
      const [active, archived] = await Promise.all([
        adapter.listProjects({ archived: false }),
        adapter.listProjects({ archived: true }),
      ]);
      setProjects(active);
      setArchivedProjects(archived);
    } catch (err: any) {
      setError(err?.message || 'Falha ao listar projetos');
    }
  }, [adapter]);

  const openProject = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const detail = await adapter.getProject(id);
      setCurrentProject(detail);
      setWorkflow(detail.workflow);
      setLastSavedSnapshot(
        JSON.stringify({
          name: detail.workflow.name,
          nodes: detail.workflow.nodes,
          connections: detail.workflow.connections,
        })
      );
    } catch (err: any) {
      setError(err?.message || 'Falha ao abrir projeto');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [adapter, setWorkflow]);

  const createNewProject = useCallback(async (name: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const emptyWf: WorkflowDefinition = {
        id: '',
        name,
        nodes: [],
        connections: [],
      };
      const detail = await adapter.createProject({ name, definition: emptyWf });
      setCurrentProject(detail);
      setWorkflow(detail.workflow);
      setLastSavedSnapshot(
        JSON.stringify({
          name: detail.workflow.name,
          nodes: detail.workflow.nodes,
          connections: detail.workflow.connections,
        })
      );
      await refreshProjects();
      return detail;
    } catch (err: any) {
      setError(err?.message || 'Falha ao criar projeto');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [adapter, setWorkflow, refreshProjects]);

  const saveCurrentProject = useCallback(async () => {
    if (!currentProject) return;
    setIsLoading(true);
    setError(null);
    try {
      const updated = await adapter.updateProject(currentProject.id, {
        name: workflow.name,
        definition: workflow,
      });
      setCurrentProject(updated);
      setLastSavedSnapshot(
        JSON.stringify({
          name: updated.workflow.name,
          nodes: updated.workflow.nodes,
          connections: updated.workflow.connections,
        })
      );
      await refreshProjects();
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar projeto');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [adapter, currentProject, workflow, refreshProjects]);

  const archiveProject = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await adapter.archiveProject(id);
      if (currentProject?.id === id) {
        setCurrentProject(null);
        setLastSavedSnapshot('');
        setWorkflow({ id: crypto.randomUUID(), name: 'Untitled workflow', nodes: [], connections: [] });
      }
      await refreshProjects();
    } catch (err: any) {
      setError(err?.message || 'Falha ao arquivar projeto');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [adapter, currentProject, refreshProjects, setWorkflow]);

  const restoreProject = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await adapter.restoreProject(id);
      await refreshProjects();
    } catch (err: any) {
      setError(err?.message || 'Falha ao restaurar projeto');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [adapter, refreshProjects]);

  const deleteProjectPermanently = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await adapter.deletePermanently(id);
      await refreshProjects();
    } catch (err: any) {
      setError(err?.message || 'Falha ao excluir projeto');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [adapter, refreshProjects]);

  const exportProject = useCallback(async (id?: string) => {
    const targetId = id || currentProject?.id;
    if (!targetId) return;

    try {
      const envelope = await adapter.exportProject(targetId);
      const jsonStr = JSON.stringify(envelope, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${envelope.project.name}.runflux.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Falha ao exportar projeto');
      throw err;
    }
  }, [adapter, currentProject]);

  const importProjectFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as RunfluxExportEnvelope;
      const imported = await adapter.importProject(parsed);
      await refreshProjects();
      await openProject(imported.id);
      return imported;
    } catch (err: any) {
      setError(err?.message || 'Arquivo de projeto inválido');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [adapter, refreshProjects, openProject]);

  useEffect(() => {
    refreshProjects().catch(() => {});
  }, [refreshProjects]);

  const value = useMemo(
    () => ({
      adapter,
      currentProject,
      projects,
      archivedProjects,
      isDirty,
      isLoading,
      error,
      refreshProjects,
      openProject,
      createNewProject,
      saveCurrentProject,
      archiveProject,
      restoreProject,
      deleteProjectPermanently,
      exportProject,
      importProjectFile,
    }),
    [
      adapter,
      currentProject,
      projects,
      archivedProjects,
      isDirty,
      isLoading,
      error,
      refreshProjects,
      openProject,
      createNewProject,
      saveCurrentProject,
      archiveProject,
      restoreProject,
      deleteProjectPermanently,
      exportProject,
      importProjectFile,
    ]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

const dummyProjectContext: ProjectContextValue = {
  adapter: defaultAdapter,
  currentProject: null,
  projects: [],
  archivedProjects: [],
  isDirty: false,
  isLoading: false,
  error: null,
  refreshProjects: async () => {},
  openProject: async () => {},
  createNewProject: async () => ({} as any),
  saveCurrentProject: async () => {},
  archiveProject: async () => {},
  restoreProject: async () => {},
  deleteProjectPermanently: async () => {},
  exportProject: async () => {},
  importProjectFile: async () => ({} as any),
};

export function useProject() {
  const context = useContext(ProjectContext);
  return context || dummyProjectContext;
}
