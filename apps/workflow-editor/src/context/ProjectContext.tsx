import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import {
  HttpProjectApiAdapter,
  type ProjectApi,
  type ProjectSummary,
  type ProjectDetail,
  type ProjectEnvVar,
  type RunfluxExportEnvelope,
} from '../adapters/project-api-adapter';
import { useWorkflowStore } from '../store/workflow-store';

export interface ProjectContextValue {
  adapter: ProjectApi;
  currentProject: ProjectDetail | null;
  projects: ProjectSummary[];
  archivedProjects: ProjectSummary[];
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;
  envVars: ProjectEnvVar[];
  setEnvVars: (envVars: ProjectEnvVar[]) => void;
  saveEnvVars: (envVars: ProjectEnvVar[]) => Promise<void>;
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

/** What saving compares: the workflow's name, nodes and connections. */
function snapshotOf(workflow: Pick<WorkflowDefinition, 'name' | 'nodes' | 'connections'>): string {
  return JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections });
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as { message?: string } | null | undefined)?.message || fallback;
}

const defaultAdapter = new HttpProjectApiAdapter();

export function ProjectProvider({
  children,
  adapter = defaultAdapter,
}: {
  children: React.ReactNode;
  adapter?: ProjectApi;
}) {
  const [currentProject, setCurrentProject] = useState<ProjectDetail | null>(null);
  const [envVars, setEnvVars] = useState<ProjectEnvVar[]>([]);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string>('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /** Runs a user action with the loading flag and the error the project manager shows; failures are rethrown. */
  const runAction = useCallback(async <TResult,>(failure: string, work: () => Promise<TResult>): Promise<TResult> => {
    setIsLoading(true);
    setError(null);
    try {
      return await work();
    } catch (err) {
      setError(errorMessage(err, failure));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const workflow = useWorkflowStore((s) => s.workflow);
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);

  // Calcula se o grafo atual no canvas difere do último snapshot salvo
  const isDirty = useMemo(() => {
    if (!currentProject || !lastSavedSnapshot) return false;
    return snapshotOf(workflow) !== lastSavedSnapshot;
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
    } catch (err) {
      setError(errorMessage(err, 'Falha ao listar projetos'));
    }
  }, [adapter]);

  const openProject = useCallback(async (id: string) => {
    return runAction('Falha ao abrir projeto', async () => {
      const detail = await adapter.getProject(id);
      setCurrentProject(detail);
      setEnvVars(detail.envVars || []);
      setWorkflow(detail.workflow);
      setLastSavedSnapshot(snapshotOf(detail.workflow));
    });
  }, [runAction, adapter, setWorkflow]);

  const createNewProject = useCallback(async (name: string) => {
    return runAction('Falha ao criar projeto', async () => {
      const emptyWf: WorkflowDefinition = {
        id: '',
        name,
        nodes: [],
        connections: [],
      };
      const detail = await adapter.createProject({ name, definition: emptyWf });
      setCurrentProject(detail);
      setEnvVars(detail.envVars || []);
      setWorkflow(detail.workflow);
      setLastSavedSnapshot(snapshotOf(detail.workflow));
      await refreshProjects();
      return detail;
    });
  }, [runAction, adapter, setWorkflow, refreshProjects]);

  const saveEnvVars = useCallback(async (newEnvVars: ProjectEnvVar[]) => {
    setEnvVars(newEnvVars);
    if (!currentProject) return;
    try {
      const saved = await adapter.updateEnvVars(currentProject.id, newEnvVars);
      setEnvVars(saved);
      setCurrentProject((prev) => (prev ? { ...prev, envVars: saved } : null));
    } catch (err) {
      setError(errorMessage(err, 'Falha ao salvar variáveis de ambiente'));
      throw err;
    }
  }, [adapter, currentProject]);

  const saveCurrentProject = useCallback(async () => {
    if (!currentProject) return;
    return runAction('Falha ao salvar projeto', async () => {
      const updated = await adapter.updateProject(currentProject.id, {
        name: workflow.name,
        definition: workflow,
      });
      setCurrentProject(updated);
      setLastSavedSnapshot(snapshotOf(updated.workflow));
      await refreshProjects();
    });
  }, [runAction, adapter, currentProject, workflow, refreshProjects]);

  const archiveProject = useCallback(async (id: string) => {
    return runAction('Falha ao arquivar projeto', async () => {
      await adapter.archiveProject(id);
      if (currentProject?.id === id) {
        setCurrentProject(null);
        setEnvVars([]);
        setLastSavedSnapshot('');
        setWorkflow({ id: crypto.randomUUID(), name: 'Untitled workflow', nodes: [], connections: [] });
      }
      await refreshProjects();
    });
  }, [runAction, adapter, currentProject, refreshProjects, setWorkflow]);

  const restoreProject = useCallback(async (id: string) => {
    return runAction('Falha ao restaurar projeto', async () => {
      await adapter.restoreProject(id);
      await refreshProjects();
    });
  }, [runAction, adapter, refreshProjects]);

  const deleteProjectPermanently = useCallback(async (id: string) => {
    return runAction('Falha ao excluir projeto', async () => {
      await adapter.deletePermanently(id);
      await refreshProjects();
    });
  }, [runAction, adapter, refreshProjects]);

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
    } catch (err) {
      setError(errorMessage(err, 'Falha ao exportar projeto'));
      throw err;
    }
  }, [adapter, currentProject]);

  const importProjectFile = useCallback(async (file: File) => {
    return runAction('Arquivo de projeto inválido', async () => {
      const text = await file.text();
      const parsed = JSON.parse(text) as RunfluxExportEnvelope;
      const imported = await adapter.importProject(parsed);
      await refreshProjects();
      await openProject(imported.id);
      return imported;
    });
  }, [runAction, adapter, refreshProjects, openProject]);

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
      envVars,
      setEnvVars,
      saveEnvVars,
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
      envVars,
      saveEnvVars,
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
  envVars: [],
  setEnvVars: () => {},
  saveEnvVars: async () => {},
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
