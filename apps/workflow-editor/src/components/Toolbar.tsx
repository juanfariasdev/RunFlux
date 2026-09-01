import { useState } from 'react';
import type { PluginCatalogAdapter } from '../adapters/plugin-catalog-adapter';
import type { ValidationRuntimeAdapter } from '../adapters/validation-runtime-adapter';
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
 * RF-07 (Salvar) and RF-06/RF-12 (Testar). Saving never validates required
 * parameters (RN-04) — testing does, via the same buildZodSchema used by
 * NodeConfigPanel, before ever calling into ValidationRuntimeAdapter.
 */
export function Toolbar({ catalog, persistence, validation }: ToolbarProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const [status, setStatus] = useState<ToolbarStatus>({ kind: 'idle' });

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

    const result = await validation.run(workflow);
    setStatus({ kind: 'tested', message: result.message ?? result.status });
  };

  return (
    <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
      <span className="text-sm font-semibold text-slate-900">{workflow.name}</span>
      <div className="ml-auto flex items-center gap-2">
        {status.kind === 'saved' && <span className="text-xs text-slate-500">Saved</span>}
        {status.kind === 'blocked' && (
          <span className="text-xs text-red-600" role="alert">
            Fill required fields on node {status.nodeId} before testing
          </span>
        )}
        {status.kind === 'tested' && <span className="text-xs text-slate-500">{status.message}</span>}
        <Button variant="outline" size="sm" onClick={handleSave}>
          Save
        </Button>
        <Button size="sm" onClick={handleTest}>
          Test
        </Button>
      </div>
    </div>
  );
}
