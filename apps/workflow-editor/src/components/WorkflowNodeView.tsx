import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { FlowNode } from '../adapters/react-flow-adapter';

const CATEGORY_LABELS: Record<string, string> = { trigger: 'Trigger', action: 'Action', output: 'Output', 'control-flow': 'Control', subworkflow: 'Subflow' };

export function WorkflowNodeView({ data, selected, dragging }: NodeProps<FlowNode>) {
  const status = data?.referenceStatus?.status ?? 'missing';
  const appearance = data?.appearance ?? {};
  const legacyLabel = data?.parameters?.label;
  const label = appearance.label?.trim() || (typeof legacyLabel === 'string' && legacyLabel.trim() ? legacyLabel : undefined) || data?.manifest?.name || data?.pluginId || 'Plugin';
  const category = data?.manifest?.category;
  const shape = appearance.shape ?? 'card';
  const color = appearance.color ?? categoryColor(category);
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
        {category !== 'trigger' && <Handle id="main" type="target" position={Position.Left} className="!h-3 !w-3 !border-[3px] !border-white !bg-[var(--node-accent)] !shadow-md transition hover:scale-125" />}
        {!isDiamond && <span className="absolute bottom-3 left-[-1px] top-3 w-1 rounded-r bg-[var(--node-accent)]" />}

        <div className={`flex h-full min-h-20 items-center ${isDiamond ? 'justify-center px-[25%] py-4 text-center' : 'gap-3 px-4 py-3'}`}>
          {!isDiamond && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-[var(--node-accent)]"><svg className="h-[19px] w-[19px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><CategoryIcon category={category} /></svg></span>}
          <span className={`flex min-w-0 flex-1 flex-col ${isDiamond ? 'items-center' : ''}`}>
            <small className="text-[8px] font-extrabold uppercase tracking-[.11em] text-[var(--node-accent)]">{CATEGORY_LABELS[category ?? ''] ?? 'Plugin'}</small>
            <strong className="mt-px max-w-full truncate text-xs leading-tight text-slate-800">{label}</strong>
            {!isDiamond && <small className="mt-0.5 truncate text-[8px] text-slate-400">{data?.pluginId}</small>}
          </span>
          {!isDiamond && <span className="self-start text-xs tracking-[-3px] text-slate-300" aria-hidden="true">⋮⋮</span>}
        </div>

        {status === 'missing' && <div className="absolute -bottom-2 right-2 rounded-md bg-red-100 px-1.5 py-0.5 text-[8px] font-bold text-red-700 shadow" role="alert">Plugin not found</div>}
        {status === 'outdated' && <div className="absolute -bottom-2 right-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-800 shadow">Update available · v{data.referenceStatus.status === 'outdated' ? data.referenceStatus.installedVersion : ''}</div>}
        {status !== 'missing' && data?.result && (
          <div
            className={`absolute -top-2 right-2 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white shadow ${data.result.error ? 'bg-red-500' : 'bg-emerald-500'}`}
            data-testid="node-result-badge"
            data-result-status={data.result.error ? 'error' : 'success'}
            title={data.result.error ?? 'Last test succeeded'}
          >
            {data.result.error ? '!' : '✓'}
          </div>
        )}
        {category !== 'output' && <Handle id="main" type="source" position={Position.Right} className="!h-3 !w-3 !border-[3px] !border-white !bg-[var(--node-accent)] !shadow-md transition hover:scale-125" />}
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

function shapeClasses(shape: string) {
  if (shape === 'rounded') return 'rounded-[25px] border shadow-lg';
  if (shape === 'pill') return 'rounded-full border shadow-lg';
  if (shape === 'diamond') return "border-0 bg-transparent shadow-none before:absolute before:inset-x-[10%] before:inset-y-0 before:-z-10 before:[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)] before:bg-white before:shadow-lg before:content-['']";
  return 'rounded-[14px] border shadow-lg';
}

function categoryColor(category: string | undefined) {
  if (category === 'trigger') return '#10b981';
  if (category === 'output') return '#f97316';
  if (category === 'control-flow') return '#8b5cf6';
  if (category === 'subworkflow') return '#0ea5e9';
  return '#4f46e5';
}

function CategoryIcon({ category }: { category: string | undefined }) {
  if (category === 'trigger') return <path d="M13 2 4.5 13H11l-1 9 8.5-12H12l1-8Z" />;
  if (category === 'output') return <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>;
  if (category === 'control-flow') return <><path d="M6 3v12a4 4 0 0 0 4 4h8" /><path d="m14 15 4 4-4 4" /></>;
  return <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /><path d="M10 6h3a4 4 0 0 1 4 4v4" /></>;
}

function LayersIcon() {
  return <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>;
}
