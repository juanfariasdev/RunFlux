import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FlowNode } from '../adapters/react-flow-adapter';

/**
 * Custom React Flow node renderer. Reflects the plugin-reference status
 * (RF-11, EC-01/EC-04/EC-06): "missing" renders as a clearly broken/corrupted
 * node; "outdated" renders with a warning badge but stays otherwise usable.
 */
export function WorkflowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const status = data.referenceStatus.status;
  const customLabel = data.parameters.label;
  const label =
    typeof customLabel === 'string' && customLabel.trim().length > 0
      ? customLabel
      : (data.manifest?.name ?? data.pluginId);
  const category = data.manifest?.category;
  // A trigger starts a flow — it never receives an incoming connection (RF-05).
  // An output node is a terminal step — it never sends to a further node.
  const showTargetHandle = category !== 'trigger';
  const showSourceHandle = category !== 'output';

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
      {showTargetHandle && <Handle type="target" position={Position.Left} />}
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
      {showSourceHandle && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
