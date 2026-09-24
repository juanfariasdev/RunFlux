import { Handle, NodeResizer, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { useEffect, type CSSProperties } from 'react';
import type { FlowNode } from '../adapters/react-flow-adapter';

const CATEGORY_LABELS: Record<string, string> = { trigger: 'Trigger', action: 'Action', output: 'Output', 'control-flow': 'Control', subworkflow: 'Subflow' };

export function WorkflowNodeView({ id, data, selected, dragging }: NodeProps<FlowNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const isVertical = data?.layout === 'vertical';
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isVertical, updateNodeInternals]);

  const status = data?.referenceStatus?.status ?? 'missing';
  const appearance = data?.appearance ?? {};
  const legacyLabel = data?.parameters?.label;
  const label = appearance.label?.trim() || (typeof legacyLabel === 'string' && legacyLabel.trim() ? legacyLabel : undefined) || data?.manifest?.name || data?.pluginId || 'Plugin';
  const category = data?.manifest?.category;
  const shape = appearance.shape ?? 'card';
  const color = appearance.color ?? categoryColor(category, data?.pluginId);
  const isDiamond = shape === 'diamond';
  const style = {
    '--node-accent': color,
    borderColor: selected ? color : status === 'missing' ? '#f87171' : '#dbe2ea',
    boxShadow: selected ? `0 0 0 3px ${color}20, 0 12px 28px rgb(15 23 42 / .13)` : undefined,
  } as CSSProperties;

  return (
    <>
      <NodeResizer isVisible={Boolean(selected && !dragging)} minWidth={isDiamond ? 150 : 180} minHeight={isDiamond ? 120 : 82} color={color} lineClassName="!border-[var(--node-accent)]" handleClassName="!h-[9px] !w-[9px] !rounded-[3px] !border-2 !border-white !bg-[var(--node-accent)] !shadow" />
      <article
        className={`relative h-full w-full overflow-visible bg-white transition duration-150 ${shapeClasses(shape)} ${status === 'missing' ? 'border-dashed' : ''} ${dragging ? 'scale-[1.025] rotate-[.4deg] opacity-90 shadow-2xl' : ''}`}
        data-testid="workflow-node"
        data-status={status}
        style={style}
      >
        {selected && status !== 'missing' && (data?.onTestNode || data?.onTestToNode) && (
          <div
            className="nodrag nopan absolute -top-10 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
            data-testid="node-test-actions"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {data.onTestNode && (
              <button
                type="button"
                className="nodrag nopan whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-semibold text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={(event) => { event.stopPropagation(); data.onTestNode?.(); }}
                disabled={data.isTesting}
                title="Execute only this node using cached upstream results"
              >
                ▶ Test this node
              </button>
            )}
            {data.onTestToNode && (
              <button
                type="button"
                className="nodrag nopan whitespace-nowrap rounded-md bg-indigo-600 px-2 py-1 text-[9px] font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={(event) => { event.stopPropagation(); data.onTestToNode?.(); }}
                disabled={data.isTesting}
                title="Execute the workflow from its trigger up to this node"
              >
                ▶ Test up to this node
              </button>
            )}
          </div>
        )}
        {category !== 'trigger' && (
          <Handle
            id="main"
            type="target"
            position={isVertical ? Position.Top : Position.Left}
            style={HANDLE_ANCHOR_STYLE}
            className="nodrag nopan"
          >
            <ConnectionDot />
          </Handle>
        )}
        {!isDiamond && <span className="absolute bottom-3 left-[-1px] top-3 w-1 rounded-r bg-[var(--node-accent)]" />}

        <div className={`flex h-full min-h-20 items-center ${isDiamond ? 'justify-center px-[25%] py-4 text-center' : 'gap-3 px-4 py-3'}`}>
          {!isDiamond && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-[var(--node-accent)]"><svg className="h-[19px] w-[19px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><CategoryIcon category={category} pluginId={data?.pluginId} /></svg></span>}
          <span className={`flex min-w-0 flex-1 flex-col ${isDiamond ? 'items-center' : ''}`}>
            <small className="text-[8px] font-extrabold uppercase tracking-[.11em] text-[var(--node-accent)]">{CATEGORY_LABELS[category ?? ''] ?? 'Plugin'}</small>
            <strong className="mt-px max-w-full truncate text-xs leading-tight text-slate-800">{label}</strong>
            {!isDiamond && <small className="mt-0.5 truncate text-[8px] text-slate-400">{data?.pluginId}</small>}
          </span>
          {!isDiamond && <span className="self-start text-xs tracking-[-3px] text-slate-300" aria-hidden="true">⋮⋮</span>}
        </div>

        {status === 'missing' && <div className="absolute -bottom-2 right-2 rounded-md bg-red-100 px-1.5 py-0.5 text-[8px] font-bold text-red-700 shadow" role="alert">Plugin not found</div>}
        {status === 'outdated' && <div className="absolute -bottom-2 right-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-800 shadow">Update available · v{data.referenceStatus.status === 'outdated' ? data.referenceStatus.installedVersion : ''}</div>}
        <OutputHandles outputs={data?.manifest?.outputs} isVertical={isVertical} />
        {data?.isTesting && (
          <div
            className="absolute -top-2.5 right-2 grid h-5 w-5 place-items-center rounded-full bg-indigo-600 text-white shadow-md ring-2 ring-indigo-200"
            data-testid="node-testing-badge"
            data-result-status="testing"
            title="Listening for webhook event…"
          >
            <svg className="h-3 w-3 animate-spin text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
          </div>
        )}
        {!data?.isTesting && status !== 'missing' && data?.result && (
          <div
            className={`absolute -top-2 right-2 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white shadow ${data.result.error ? 'bg-red-500' : 'bg-emerald-500'}`}
            data-testid="node-result-badge"
            data-result-status={data.result.error ? 'error' : 'success'}
            title={data.result.error ?? 'Last test succeeded'}
          >
            {data.result.error ? '!' : '✓'}
          </div>
        )}
      </article>
    </>
  );
}

export function SubflowNodeView({ data, selected, dragging }: NodeProps<FlowNode>) {
  const color = data?.appearance?.color ?? '#8b5cf6';
  return (
    <>
      <NodeResizer isVisible={Boolean(selected && !dragging)} minWidth={360} minHeight={220} color={color} lineClassName="!border-[var(--node-accent)]" handleClassName="!h-[9px] !w-[9px] !rounded-[3px] !border-2 !border-white !bg-[var(--node-accent)] !shadow" />
      <section className={`relative h-full w-full overflow-hidden rounded-[20px] border-2 border-dashed bg-white/80 shadow-inner transition ${selected ? 'border-solid ring-4 ring-violet-100 shadow-lg' : 'border-violet-300'} ${dragging ? 'shadow-2xl' : ''}`} style={{ '--node-accent': color, borderColor: selected ? color : undefined } as CSSProperties} data-testid="subflow-node">
        <header className="flex h-[58px] items-center gap-2.5 border-b border-violet-100 bg-violet-50/70 px-4">
          <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-white text-[var(--node-accent)] shadow-sm"><LayersIcon /></span>
          <span className="flex flex-col"><small className="text-[8px] font-extrabold tracking-[.13em] text-[var(--node-accent)]">SUBFLOW</small><strong className="text-xs text-slate-800">{data?.appearance?.label?.trim() || 'New subflow'}</strong></span>
          <small className="ml-auto text-[9px] text-slate-400">Drag nodes inside</small>
        </header>
        <div className="pointer-events-none absolute bottom-3.5 left-3.5 right-3.5 top-[72px] rounded-xl border border-dashed border-violet-200" />
      </section>
    </>
  );
}

const OUTPUT_HANDLE_CLASSNAME =
  'nodrag nopan';

const HANDLE_ANCHOR_STYLE: CSSProperties = {
  width: 0,
  height: 0,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
  boxShadow: 'none',
  zIndex: 1,
};

const HANDLE_DOT_CLASSNAME =
  'pointer-events-auto absolute left-0 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-[var(--node-accent)] shadow-md transition hover:scale-125';

function ConnectionDot() {
  return <span className={HANDLE_DOT_CLASSNAME} data-testid="connection-dot" aria-hidden="true" />;
}

/**
 * Renders one source handle per entry in `manifest.outputs` (004-core-nodes-catalog,
 * RF-08), each labeled and independently connectable. A manifest without
 * `outputs` keeps the single unlabeled `id="main"` handle every plugin had
 * before this feature (backward compatibility).
 */
function OutputHandles({ outputs, isVertical }: { outputs?: string[]; isVertical: boolean }) {
  const position = isVertical ? Position.Bottom : Position.Right;
  if (!outputs || outputs.length === 0) {
    return (
      <Handle id="main" type="source" position={position} style={HANDLE_ANCHOR_STYLE} className={OUTPUT_HANDLE_CLASSNAME} data-testid="output-handle">
        <ConnectionDot />
      </Handle>
    );
  }

  return (
    <>
      {outputs.map((outputId, index) => (
        <Handle
          key={outputId}
          id={outputId}
          type="source"
          position={position}
          style={{
            ...HANDLE_ANCHOR_STYLE,
            ...(isVertical ? { left: `${((index + 1) / (outputs.length + 1)) * 100}%` } : { top: `${((index + 1) / (outputs.length + 1)) * 100}%` }),
          }}
          className={OUTPUT_HANDLE_CLASSNAME}
          data-testid="output-handle"
        >
          <ConnectionDot />
          <span
            className={`pointer-events-none absolute whitespace-nowrap rounded bg-slate-800/90 px-1 py-0.5 text-[7px] font-bold text-white ${isVertical ? 'left-1/2 top-[14px] -translate-x-1/2' : 'right-[14px] top-1/2 -translate-y-1/2'}`}
            data-testid="output-handle-label"
          >
            {outputId}
          </span>
        </Handle>
      ))}
    </>
  );
}

function shapeClasses(shape: string) {
  if (shape === 'rounded') return 'rounded-[25px] border shadow-lg';
  if (shape === 'pill') return 'rounded-full border shadow-lg';
  if (shape === 'diamond') return "border-0 bg-transparent shadow-none before:absolute before:inset-x-[10%] before:inset-y-0 before:-z-10 before:[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)] before:bg-white before:shadow-lg before:content-['']";
  return 'rounded-[14px] border shadow-lg';
}

function categoryColor(category: string | undefined, pluginId?: string) {
  if (pluginId === 'database-query') return '#0891b2';
  if (pluginId === 'code-javascript') return '#8b5cf6';
  if (category === 'trigger') return '#10b981';
  if (category === 'output') return '#f97316';
  if (category === 'control-flow') return '#8b5cf6';
  if (category === 'subworkflow') return '#0ea5e9';
  return '#4f46e5';
}

function CategoryIcon({ category, pluginId }: { category: string | undefined; pluginId?: string }) {
  if (pluginId === 'database-query') return <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>;
  if (pluginId === 'code-javascript') return <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />;
  if (category === 'trigger') return <path d="M13 2 4.5 13H11l-1 9 8.5-12H12l1-8Z" />;
  if (category === 'output') return <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>;
  if (category === 'control-flow') return <><path d="M6 3v12a4 4 0 0 0 4 4h8" /><path d="m14 15 4 4-4 4" /></>;
  return <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /><path d="M10 6h3a4 4 0 0 1 4 4v4" /></>;
}

function LayersIcon() {
  return <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>;
}
