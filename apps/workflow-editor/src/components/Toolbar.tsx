import { lazy, Suspense, useState, useEffect } from 'react';
import type { WorkflowNode } from '@runflux/workflow-model/types';
import type { PluginCatalogAdapter } from '../adapters/plugin-catalog-adapter';
import type { PluginExecutionMode, ValidationRuntimeAdapter } from '../adapters/validation-runtime-adapter';
import type { WorkflowPersistenceAdapter } from '../adapters/workflow-persistence-adapter';
import { useWorkflowStore } from '../store/workflow-store';
import { Button } from './ui/button';
import { useProject } from '../context/ProjectContext';
import { projectEnvironment } from '../adapters/project-environment';
import { webhookTestRequest } from '../adapters/webhook-test-request';

const ProjectManagerModal = lazy(() => import('./ProjectManagerModal').then((module) => ({ default: module.ProjectManagerModal })));
const CompilerModal = lazy(() => import('./CompilerModal').then((module) => ({ default: module.CompilerModal })));
const EnvVarsModal = lazy(() => import('./EnvVarsModal').then((module) => ({ default: module.EnvVarsModal })));

export interface ToolbarProps {
  catalog: PluginCatalogAdapter;
  persistence: WorkflowPersistenceAdapter;
  validation: ValidationRuntimeAdapter;
  /** Called with the node ids that should show the canvas "waiting" badge for the run's duration (every Webhook Trigger while `validation.run` is in flight), and `[]` once it settles. */
  onTestingNodesChange?: (nodeIds: string[]) => void;
}

type ToolbarStatus =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'blocked'; nodeId: string }
  | { kind: 'tested'; message: string }
  | { kind: 'error'; message: string };

/**
 * RF-07 (Save) and RF-06/RF-12 (Test). Saving never validates required
 * parameters (RN-04) — testing does, via the same buildZodSchema used by
 * NodeConfigPanel, before ever calling into ValidationRuntimeAdapter.
 * Integrates ProjectContext (005-workflow-project-management) and CompilerModal (006-compiler).
 */
export function Toolbar({ catalog, persistence, validation, onTestingNodesChange }: ToolbarProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const setNodeResults = useWorkflowStore((s) => s.setNodeResults);
  const clearNodeResults = useWorkflowStore((s) => s.clearNodeResults);
  const [status, setStatus] = useState<ToolbarStatus>({ kind: 'idle' });
  const [mode, setMode] = useState<PluginExecutionMode>('sandbox');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCompilerOpen, setIsCompilerOpen] = useState(false);
  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // A workflow-level test runs every node, including any Webhook Trigger — which,
  // just like testing it in isolation (NodeConfigPanel), blocks for up to 120s
  // waiting for a real HTTP request. Without this the whole run just sits there
  // with no visible sign anything is happening — "the Test button does nothing".
  // Each one is independent (the engine now runs every trigger branch concurrently,
  // not one after another) and needs its OWN row: a run with 2 webhooks only ever
  // finishes once BOTH have received a request, so the UI must give a way to send
  // a test payload to each of them individually, not just the first one.
  const webhookNodes = workflow.nodes.filter((n) => n.pluginId === 'trigger-webhook');

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
    // Clear whatever the last run left showing (a stale "✓ ok"/error) — otherwise it
    // sits there, unrelated to this run, for the whole time a new test is in flight.
    setStatus({ kind: 'idle' });

    const grouped = await catalog.listPlugins();
    const manifestsById = new Map(Object.values(grouped).flat().map((m) => [m.id, m]));
    const { buildZodSchema } = await import('../forms/build-zod-schema');

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

    // Same reasoning as the status line above, but for the canvas: `setNodeResults`
    // merges into the existing map, so every node's stale "✓" from the last run would
    // otherwise sit there — some possibly already re-evaluated differently — for the
    // whole time this new run is in flight (only cleared node-by-node as each result
    // actually arrives, up to 120s late for one still waiting on a webhook).
    clearNodeResults();
    setIsRunning(true);
    onTestingNodesChange?.(webhookNodes.map((n) => n.id));
    try {
      const result = await validation.run(workflow, { mode, environment: projectEnvironment(projectCtx?.envVars) });
      setNodeResults(result.nodeResults ?? []);
      setStatus({ kind: 'tested', message: result.message ?? result.status });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Test run failed' });
    } finally {
      setIsRunning(false);
      onTestingNodesChange?.([]);
    }
  };

  const handleCancelTest = async () => {
    await fetch('/runflux-webhook-cancel', { method: 'POST' }).catch(() => {});
  };

  const handleSendTestPayload = async (node: WorkflowNode) => {
    const { url, init } = webhookTestRequest(node.parameters, window.location.origin);
    await fetch(url, init).catch(() => {});
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
          {status.kind === 'error' && (
            <span className="max-w-xs truncate text-[11px] font-semibold text-red-600" role="alert" title={status.message}>
              {status.message}
            </span>
          )}
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
          <Button size="sm" onClick={handleTest} disabled={isRunning}>
            {isRunning ? '⏳ Testing…' : '▶ Test'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEnvModalOpen(true)}
            className="text-xs font-medium relative"
            data-testid="open-env-modal-btn"
          >
            💲 Env Vars
            {projectCtx?.envVars && projectCtx.envVars.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.2 text-[9px] font-bold leading-none text-emerald-800 bg-emerald-100 rounded-full" data-testid="env-vars-count">
                {projectCtx.envVars.length}
              </span>
            )}
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

      {isRunning && webhookNodes.length > 0 && (
        <div className="z-10 border-b border-indigo-200 bg-indigo-50/80 px-5 py-2 text-[11px] text-indigo-900" data-testid="toolbar-webhook-waiting-banner">
          {webhookNodes.map((node) => (
            <div key={node.id} className="flex items-center gap-3 py-0.5">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-600" />
              </span>
              <span className="font-semibold">
                Waiting for an incoming webhook on {(node.parameters.path as string) || '/webhook'}…
              </span>
              <button type="button" onClick={() => handleSendTestPayload(node)} className="ml-auto font-semibold text-indigo-600 hover:underline">
                ⚡ Send test payload now
              </button>
            </div>
          ))}
          <div className="flex justify-end pt-0.5">
            <button type="button" onClick={handleCancelTest} className="font-semibold text-red-600 hover:underline">
              ⏹ Stop all
            </button>
          </div>
        </div>
      )}

      {isModalOpen && (
        <Suspense fallback={null}>
          <ProjectManagerModal isOpen onClose={() => setIsModalOpen(false)} />
        </Suspense>
      )}

      {isCompilerOpen && (
        <Suspense fallback={null}>
          <CompilerModal isOpen onClose={() => setIsCompilerOpen(false)} />
        </Suspense>
      )}

      {isEnvModalOpen && (
        <Suspense fallback={null}>
          <EnvVarsModal isOpen onClose={() => setIsEnvModalOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
