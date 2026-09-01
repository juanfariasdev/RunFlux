import type { WorkflowConnection, WorkflowEdgeType } from '@runflux/workflow-model/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

const EDGE_COLORS = ['#64748b', '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];

interface EdgeConfigPanelProps {
  connection: WorkflowConnection;
  onChange: (appearance: Pick<WorkflowConnection, 'label' | 'animated' | 'type' | 'color'>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function EdgeConfigPanel({ connection, onChange, onDelete, onClose }: EdgeConfigPanelProps) {
  const update = (change: Partial<WorkflowConnection>) => onChange({
    label: change.label ?? connection.label,
    animated: change.animated ?? connection.animated,
    type: change.type ?? connection.type,
    color: change.color ?? connection.color,
  });

  return (
    <aside className="w-[310px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white max-[1120px]:w-[280px]" aria-label="Edge configuration">
      <header className="sticky top-0 z-[3] flex min-h-[72px] items-center justify-between border-b border-slate-200 bg-white/95 px-[17px] py-3.5 backdrop-blur-xl">
        <div><span className="mb-0.5 block text-[9px] font-extrabold tracking-[.16em] text-indigo-500">SELECTED CONNECTION</span><h2 className="m-0 text-[15px] font-bold tracking-tight">Edge</h2></div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel" className="w-[30px] px-0 text-slate-400">✕</Button>
      </header>

      <section className="border-b border-slate-100 p-[17px]">
        <div className="mb-[15px] flex flex-col"><h3 className="m-0 text-[11px] font-bold text-slate-800">Connection style</h3><span className="mt-0.5 text-[9px] text-slate-400">Control readability and motion</span></div>
        <div><Label className="mb-1 block" htmlFor="edge-label">Label</Label><Input id="edge-label" value={connection.label ?? ''} placeholder="E.g. success" onChange={(event) => update({ label: event.target.value })} /></div>
        <div className="mt-3.5">
          <Label className="mb-1 block" htmlFor="edge-type">Type</Label>
          <select className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50" id="edge-type" value={connection.type ?? 'smoothstep'} onChange={(event) => update({ type: event.target.value as WorkflowEdgeType })}>
            <option value="smoothstep">Smooth step</option><option value="bezier">Bezier</option><option value="straight">Straight</option>
          </select>
        </div>
        <label className="mt-4 flex cursor-pointer items-center justify-between">
          <span className="flex flex-col"><strong className="text-[10px] text-slate-700">Animated edge</strong><small className="text-[8px] font-normal text-slate-400">Show the direction of the flow</small></span>
          <input className="h-[18px] w-8 accent-indigo-600" type="checkbox" checked={connection.animated ?? false} onChange={(event) => update({ animated: event.target.checked })} />
        </label>
        <div className="mt-3.5">
          <Label className="mb-1.5 block">Color</Label>
          <div className="flex flex-wrap gap-2">
            {EDGE_COLORS.map((color) => <button key={color} type="button" className={`h-6 w-6 rounded-full border-2 border-white shadow-[0_0_0_1px_#dbe3ec] transition hover:scale-110 ${(connection.color ?? '#64748b') === color ? 'ring-2 ring-indigo-400 ring-offset-2' : ''}`} style={{ backgroundColor: color }} onClick={() => update({ color })} aria-label={`Use color ${color}`} />)}
            <label className="relative grid h-6 w-6 cursor-pointer place-items-center rounded-full border-2 border-white bg-gradient-to-br from-red-400 via-emerald-400 to-violet-500 text-white shadow-[0_0_0_1px_#dbe3ec]"><input className="absolute h-px w-px opacity-0" type="color" value={connection.color ?? '#64748b'} onChange={(event) => update({ color: event.target.value })} aria-label="Custom color" />＋</label>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-slate-100 p-[17px] text-[9px] text-slate-600">
        <span className="flex min-w-0 flex-col truncate"><small className="text-[7px] font-extrabold tracking-widest text-slate-400">SOURCE</small>{connection.sourceNodeId.slice(0, 12)}</span>
        <span className="text-base text-indigo-500">→</span>
        <span className="flex min-w-0 flex-col truncate"><small className="text-[7px] font-extrabold tracking-widest text-slate-400">TARGET</small>{connection.targetNodeId.slice(0, 12)}</span>
      </section>
      <footer className="flex justify-end px-[17px] pb-6 pt-3.5"><Button variant="destructive" size="sm" onClick={onDelete}>Delete edge</Button></footer>
    </aside>
  );
}
