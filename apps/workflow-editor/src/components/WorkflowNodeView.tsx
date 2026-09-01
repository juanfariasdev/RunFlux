import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FlowNode } from '../adapters/react-flow-adapter';

/**
 * Custom React Flow node renderer. Reflects the plugin-reference status
 * (RF-11, EC-01/EC-04/EC-06): "missing" renders as a clearly broken/corrupted
 * node; "outdated" renders with a warning badge but stays otherwise usable.
 */
export function WorkflowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const status = data.referenceStatus.status;
  const label = data.manifest?.name ?? data.pluginId;

  const borderClass =
    status === 'missing'
      ? 'border-red-500 border-dashed'
      : status === 'outdated'
        ? 'border-amber-400'
        : selected
          ? 'border-slate-900'
          : 'border-slate-300';

  return (
    <div
      className={`min-w-[140px] rounded-md border-2 bg-white px-3 py-2 shadow-sm ${borderClass}`}
      data-testid="workflow-node"
      data-status={status}
    >
      <Handle type="target" position={Position.Left} />
      <div className="text-sm font-medium text-slate-900">{label}</div>
      {status === 'missing' && (
        <div className="mt-1 text-xs text-red-600" role="alert">
          Plugin not found — replace this node
        </div>
      )}
      {status === 'outdated' && (
        <div className="mt-1 text-xs text-amber-600">
          Plugin updated (installed v{data.referenceStatus.status === 'outdated' ? data.referenceStatus.installedVersion : ''})
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
