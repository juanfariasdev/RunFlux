import { useState } from 'react';
import type { PluginCatalogAdapter } from '../adapters/plugin-catalog-adapter';
import type { PluginExecutionMode, ValidationRuntimeAdapter } from '../adapters/validation-runtime-adapter';
import type { WorkflowPersistenceAdapter } from '../adapters/workflow-persistence-adapter';
import { buildZodSchema } from '../forms/build-zod-schema';
import { useWorkflowStore } from '../store/workflow-store';
import { Button } from './ui/button';

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
 */
export function Toolbar({ catalog, persistence, validation }: ToolbarProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const setNodeResults = useWorkflowStore((s) => s.setNodeResults);
  const [status, setStatus] = useState<ToolbarStatus>({ kind: 'idle' });
  const [mode, setMode] = useState<PluginExecutionMode>('sandbox');

  const handleSave = async () => {
    await persistence.save(workflow);
    setStatus({ kind: 'saved' });
  };

  const handleTest = async () => {
    const grouped = await catalog.listPlugins();
    const manifestsById = new Map(Object.values(grouped).flat().map((m) => [m.id, m]));

    for (const node of workflow.nodes) {
      const manifest = manifestsById.get(node.pluginId);
      if (!manifest) continue; // a missing plugin is reported by the node itself (RF-11), not here
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
    <header className="z-20 flex h-[62px] shrink-0 items-center gap-4 border-b border-slate-200 bg-white/95 px-5 shadow-sm backdrop-blur-xl">
      <div className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-200">R</span>
        <span>RunFlux</span>
      </div>
      <span className="h-6 w-px bg-slate-200" />
      <div className="flex min-w-0 flex-col">
        <strong className="max-w-sm truncate text-[13px]">{workflow.name}</strong>
        <span className="text-[10px] font-semibold text-slate-400">{workflow.nodes.length} nodes · {workflow.connections.length} edges</span>
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
        <Button variant="outline" size="sm" onClick={handleSave} aria-label="Save workflow">
          Save
        </Button>
        <Button size="sm" onClick={handleTest}>
          ▶ Test
        </Button>
      </div>
    </header>
  );
}
