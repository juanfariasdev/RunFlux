import { useState, useEffect } from 'react';
import type { PluginCatalogAdapter } from '../adapters/plugin-catalog-adapter';
import type { PluginExecutionMode, ValidationRuntimeAdapter } from '../adapters/validation-runtime-adapter';
import type { WorkflowPersistenceAdapter } from '../adapters/workflow-persistence-adapter';
import { buildZodSchema } from '../forms/build-zod-schema';
import { useWorkflowStore } from '../store/workflow-store';
import { Button } from './ui/button';
import { useProject } from '../context/ProjectContext';
import { ProjectManagerModal } from './ProjectManagerModal';
import { CompilerModal } from './CompilerModal';

export interface ToolbarProps {
  catalog: PluginCatalogAdapter;
  persistence: WorkflowPersistenceAdapter;
  validation: ValidationRuntimeAdapter;
}

type ToolbarStatus = { kind: 'idle' } | { kind: 'saved' } | { kind: 'blocked'; nodeId: string } | { kind: 'tested'; message: string };

/**
 * RF-07 (Save) and RF-06/RF-12 (Test). Saving never validates required
 * parameters (RN-04) — testing does, via the same buildZodSchema used by
 * NodeConfigPanel, before ever calling into ValidationRuntimeAdapter.
 * Integrates ProjectContext (005-workflow-project-management) and CompilerModal (006-compiler).
 */
export function Toolbar({ catalog, persistence, validation }: ToolbarProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const setNodeResults = useWorkflowStore((s) => s.setNodeResults);
  const [status, setStatus] = useState<ToolbarStatus>({ kind: 'idle' });
  const [mode, setMode] = useState<PluginExecutionMode>('sandbox');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCompilerOpen, setIsCompilerOpen] = useState(false);

  let projectCtx: ReturnType<typeof useProject> | null = null;
  try {
    projectCtx = useProject();
  } catch {
    projectCtx = null;
  }

  const currentProject = projectCtx?.currentProject;
  const isDirty = projectCtx?.isDirty;

  // Atalho de teclado Ctrl+S / Cmd+S (RF-02, D-07)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleSave = async () => {
    if (projectCtx && projectCtx.currentProject) {
      await projectCtx.saveCurrentProject();
      setStatus({ kind: 'saved' });
    } else {
      await persistence.save(workflow);
      setStatus({ kind: 'saved' });
    }
  };

  const handleTest = async () => {
    const grouped = await catalog.listPlugins();
    const manifestsById = new Map(Object.values(grouped).flat().map((m) => [m.id, m]));

    for (const node of workflow.nodes) {
      const manifest = manifestsById.get(node.pluginId);
      if (!manifest) continue;
      const schema = buildZodSchema(manifest.parameters);
      const result = schema.safeParse(node.parameters);
      if (!result.success) {
        setStatus({ kind: 'blocked', nodeId: node.id });
        return;
      }
    }

    const result = await validation.run(workflow, { mode });
    setNodeResults(result.nodeResults ?? []);
    setStatus({ kind: 'tested', message: result.message ?? result.status });
  };

  return (
    <>
      <header className="z-20 flex h-[62px] shrink-0 items-center gap-4 border-b border-slate-200 bg-white/95 px-5 shadow-sm backdrop-blur-xl">
        <div className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-200">R</span>
          <span>RunFlux</span>
        </div>
        <span className="h-6 w-px bg-slate-200" />

        {/* Project trigger & Dirty status */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-slate-200/80 px-2.5 py-1 text-left hover:border-indigo-300 hover:bg-slate-50 transition-all"
            title="Abrir Gerenciador de Projetos"
            data-testid="project-selector-btn"
          >
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <strong className="max-w-[200px] truncate text-[13px] text-slate-800">
                  {currentProject?.name || workflow.name}
                </strong>
                {currentProject?.currentWorkflowVersion && (
                  <span className="rounded bg-slate-100 px-1 py-0.2 text-[10px] font-mono text-slate-500">
                    {currentProject.currentWorkflowVersion}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold text-slate-400">
                {workflow.nodes.length} nodes · {workflow.connections.length} edges
              </span>
            </div>
            <span className="text-xs text-slate-400">▼</span>
          </button>

          {isDirty && (
            <span
              data-testid="dirty-badge"
              className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              Alterações não salvas
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {status.kind === 'saved' && (
            <span className="text-[11px] font-semibold text-emerald-600" role="status">
              <span aria-hidden="true">✓</span> Saved
            </span>
          )}
          {status.kind === 'blocked' && (
            <span className="max-w-xs text-[11px] font-semibold text-red-600" role="alert">
              Fill required fields on node {status.nodeId} before testing
            </span>
          )}
          {status.kind === 'tested' && <span className="text-[11px] font-semibold text-emerald-600">{status.message}</span>}
          <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
            <span className="sr-only">Execution mode</span>
            <select
              className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] font-semibold text-slate-600"
              value={mode}
              onChange={(event) => setMode(event.target.value as PluginExecutionMode)}
              aria-label="Execution mode"
            >
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={handleSave} aria-label="Save workflow" data-testid="save-project-btn">
            Save
          </Button>
          <Button size="sm" onClick={handleTest}>
            ▶ Test
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsModalOpen(true)}
            className="text-xs font-medium"
            data-testid="open-projects-modal-btn"
          >
            📁 Projetos
          </Button>
          <Button
            size="sm"
            onClick={() => setIsCompilerOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-sm shadow-indigo-200"
            data-testid="open-compiler-modal-btn"
          >
            ⚡ Compile
          </Button>
        </div>
      </header>

      <ProjectManagerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />

      <CompilerModal
        isOpen={isCompilerOpen}
        onClose={() => setIsCompilerOpen(false)}
      />
    </>
  );
}
