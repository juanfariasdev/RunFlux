import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { WorkflowNodeAppearance, WorkflowNodeShape } from '@runflux/workflow-model/types';
import { buildZodSchema } from '../forms/build-zod-schema';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Label } from './ui/label';

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#334155'];
const SHAPES: { value: WorkflowNodeShape; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'pill', label: 'Pill' },
  { value: 'diamond', label: 'Decision' },
];

export interface NodeConfigPanelProps {
  manifest?: PluginManifest;
  values: Record<string, unknown>;
  appearance?: WorkflowNodeAppearance;
  onChange: (values: Record<string, unknown>) => void;
  onAppearanceChange?: (appearance: Partial<WorkflowNodeAppearance>) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function NodeConfigPanel({
  manifest,
  values,
  appearance = {},
  onChange,
  onAppearanceChange,
  onDelete,
  onClose,
}: NodeConfigPanelProps) {
  const parameters = manifest?.parameters ?? [];
  const schema = buildZodSchema(parameters);
  const { register, watch, formState } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: values,
    mode: 'onChange',
  });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const isSubflow = appearance.shape === 'subflow';

  useEffect(() => {
    const subscription = watch((formValues) => onChange(formValues as Record<string, unknown>));
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  return (
    <aside className="w-[310px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white max-[1120px]:w-[280px] [scrollbar-color:#cbd5e1_transparent] [scrollbar-width:thin]" aria-label="Node configuration">
      <header className="sticky top-0 z-[3] flex min-h-[72px] items-center justify-between border-b border-slate-200 bg-white/95 px-[17px] py-3.5 backdrop-blur-xl">
        <div>
          <span className="mb-0.5 block text-[9px] font-extrabold tracking-[.16em] text-indigo-500">SELECTED NODE</span>
          <h2 className="m-0 max-w-[220px] truncate text-[15px] font-bold tracking-tight">{appearance.label?.trim() || manifest?.name || 'Subflow'}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel" className="w-[30px] px-0 text-slate-400">✕</Button>
      </header>

      <section className="border-b border-slate-100 p-[17px]">
        <div className="mb-[15px] flex flex-col">
          <h3 className="m-0 text-[11px] font-bold text-slate-800">Appearance</h3>
          <span className="mt-0.5 text-[9px] text-slate-400">Customize how it looks on the canvas</span>
        </div>

        <Label className="mb-1 block" htmlFor="node-display-label">Node label</Label>
        <Input
          id="node-display-label"
          value={appearance.label ?? ''}
          placeholder={manifest?.name ?? 'Subflow name'}
          onChange={(event) => onAppearanceChange?.({ label: event.target.value })}
        />

        {!isSubflow && (
          <div className="mt-3.5">
            <Label className="mb-1 block">Shape</Label>
            <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Node shape">
              {SHAPES.map((shape) => (
                <button
                  type="button"
                  key={shape.value}
                  className={`flex h-[51px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg border text-[8px] transition ${appearance.shape === shape.value || (!appearance.shape && shape.value === 'card') ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:bg-indigo-50'}`}
                  onClick={() => onAppearanceChange?.({ shape: shape.value })}
                  aria-pressed={appearance.shape === shape.value}
                >
                  <span className={shapePreviewClasses(shape.value)} />
                  {shape.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3.5">
          <Label className="mb-1.5 block">Color</Label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((color) => (
              <button
                type="button"
                key={color}
                className={`h-6 w-6 cursor-pointer rounded-full border-2 border-white shadow-[0_0_0_1px_#dbe3ec] transition hover:scale-110 ${(appearance.color ?? '#4f46e5') === color ? 'ring-2 ring-indigo-400 ring-offset-2' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => onAppearanceChange?.({ color })}
                aria-label={`Use color ${color}`}
                aria-pressed={(appearance.color ?? '#4f46e5') === color}
              />
            ))}
            <label className="relative grid h-6 w-6 cursor-pointer place-items-center rounded-full border-2 border-white bg-gradient-to-br from-red-400 via-emerald-400 to-violet-500 text-[13px] text-white shadow-[0_0_0_1px_#dbe3ec]" title="Choose a custom color">
              <input
                className="absolute h-px w-px opacity-0"
                type="color"
                value={appearance.color ?? '#4f46e5'}
                onChange={(event) => onAppearanceChange?.({ color: event.target.value })}
                aria-label="Custom color"
              />
              ＋
            </label>
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <span className="flex flex-col rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-[10px] font-semibold text-slate-700"><small className="text-[7px] font-extrabold tracking-widest text-slate-400">WIDTH</small>{Math.round(appearance.width ?? (isSubflow ? 520 : 220))} px</span>
          <span className="flex flex-col rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-[10px] font-semibold text-slate-700"><small className="text-[7px] font-extrabold tracking-widest text-slate-400">HEIGHT</small>{Math.round(appearance.height ?? (isSubflow ? 300 : 104))} px</span>
        </div>
        <p className="mb-0 mt-2 text-[8px] leading-relaxed text-slate-400">Select the node and drag its border handles to resize it.</p>
      </section>

      {!isSubflow && (
        <section className="border-b border-slate-100 p-[17px]">
          <div className="mb-[15px] flex flex-col">
            <h3 className="m-0 text-[11px] font-bold text-slate-800">Configuration</h3>
            <span className="mt-0.5 text-[9px] text-slate-400">{manifest ? `Type · ${manifest.category}` : 'Plugin unavailable'}</span>
          </div>
          <form className="grid gap-3.5" onSubmit={(event) => event.preventDefault()}>
            {parameters.map((param) => (
              <div key={param.name}>
                <Label className="mb-1 block" htmlFor={param.name}>{param.label}{param.required && <span className="ml-0.5 text-red-500">*</span>}</Label>
                {param.type === 'boolean' ? (
                  <Checkbox id={param.name} {...register(param.name)} />
                ) : param.sensitive ? (
                  <div className="flex gap-1.5">
                    <Input id={param.name} type={revealed[param.name] ? 'text' : 'password'} autoComplete="off" {...register(param.name)} />
                    <button className="grid w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500" type="button" onClick={() => setRevealed((previous) => ({ ...previous, [param.name]: !previous[param.name] }))} aria-label={revealed[param.name] ? 'Hide value' : 'Show value'} aria-pressed={!!revealed[param.name]}>
                      {revealed[param.name] ? <UnlockIcon /> : <LockIcon />}
                    </button>
                  </div>
                ) : (
                  <Input id={param.name} type={param.type === 'number' ? 'number' : 'text'} {...register(param.name, { valueAsNumber: param.type === 'number' })} />
                )}
                {formState.errors[param.name] && <p className="mb-0 mt-1 text-[9px] text-red-600">{String(formState.errors[param.name]?.message ?? 'Invalid value')}</p>}
              </div>
            ))}
            {parameters.length === 0 && <p className="m-0 text-[10px] text-slate-400">This node has no additional parameters.</p>}
          </form>
        </section>
      )}

      {onDelete && (
        <footer className="flex justify-end px-[17px] pb-6 pt-3.5">
          <Button variant="destructive" size="sm" onClick={onDelete}>Delete node</Button>
        </footer>
      )}
    </aside>
  );
}

function shapePreviewClasses(shape: WorkflowNodeShape) {
  const base = 'block h-[13px] w-[22px] border-[1.5px] border-current';
  if (shape === 'rounded') return `${base} rounded-[7px]`;
  if (shape === 'pill') return `${base} rounded-full`;
  if (shape === 'diamond') return `${base} h-[14px] w-[14px] rotate-45 scale-75 rounded-sm`;
  return `${base} rounded-[3px]`;
}

function LockIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}

function UnlockIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.4-2" /></svg>;
}
