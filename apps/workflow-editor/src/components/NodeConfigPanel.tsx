import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resolveExpressions } from '@runflux/expression-engine';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { NodeResult } from '@runflux/validation-runtime';
import type { WorkflowNodeAppearance, WorkflowNodeShape } from '@runflux/workflow-model/types';
import { buildZodSchema } from '../forms/build-zod-schema';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { JsonFieldEditor } from './JsonFieldEditor';

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#334155'];
const SHAPES: { value: WorkflowNodeShape; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'pill', label: 'Pill' },
  { value: 'diamond', label: 'Decision' },
];

/** Does this string contain at least one `{{ }}` marker (004-core-nodes-catalog, E003)? */
function hasExpressionSyntax(text: string): boolean {
  return /\{\{[\s\S]*?\}\}/.test(text);
}

type ExpressionPreview = { ok: true; value: unknown } | { ok: false; error: string };

interface InitialFormState {
  values: Record<string, unknown>;
  changed: boolean;
}

function normalizeLegacySetFields(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, 'name') || Object.hasOwn(record, 'key') || Object.hasOwn(record, 'value')) {
    const name = record.name ?? record.key ?? '';
    return [{ name: typeof name === 'string' ? name : String(name), value: record.value ?? '' }];
  }

  return Object.entries(record).map(([name, fieldValue]) => ({ name, value: fieldValue }));
}

function buildInitialFormState(manifest: PluginManifest | undefined, values: Record<string, unknown>): InitialFormState {
  const initialValues = { ...values };
  let changed = false;

  for (const parameter of manifest?.parameters ?? []) {
    if (initialValues[parameter.name] === undefined && parameter.default !== undefined) {
      initialValues[parameter.name] = parameter.default;
      changed = true;
    }

    if (manifest?.id === 'set' && parameter.name === 'fields' && !Array.isArray(initialValues.fields)) {
      initialValues.fields = normalizeLegacySetFields(initialValues.fields);
      changed = true;
    }
  }

  return { values: initialValues, changed };
}

/**
 * Resolves a parameter's live text through the same `resolveExpressions` the
 * validation engine uses (004-core-nodes-catalog, D-02), against the node's
 * last known test input (`$json`) when one exists, otherwise an empty object
 * — good enough to catch syntax/reference errors even before the node has
 * ever been tested.
 */
function resolveExpressionPreview(text: string, sampleJson: unknown): ExpressionPreview {
  try {
    const resolved = resolveExpressions({ value: text }, { $json: sampleJson ?? {} });
    return { ok: true, value: resolved.value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface NodeConfigPanelProps {
  manifest?: PluginManifest;
  values: Record<string, unknown>;
  appearance?: WorkflowNodeAppearance;
  onChange: (values: Record<string, unknown>) => void;
  onAppearanceChange?: (appearance: Partial<WorkflowNodeAppearance>) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** RF-04: test this node in isolation. Omitted for nodes that cannot be tested (e.g. subflows). */
  onTest?: () => void;
  isTesting?: boolean;
  /** RF-02/RF-05: the node's last validation result, if it has one this session. */
  testResult?: NodeResult;
}

export function NodeConfigPanel({
  manifest,
  values,
  appearance = {},
  onChange,
  onAppearanceChange,
  onDelete,
  onClose,
  onTest,
  isTesting = false,
  testResult,
}: NodeConfigPanelProps) {
  const parameters = manifest?.parameters ?? [];
  const schema = buildZodSchema(parameters);
  const initialFormState = useMemo(() => buildInitialFormState(manifest, values), [manifest, values]);
  const { register, watch, control, formState } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: initialFormState.values,
    mode: 'onChange',
  });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [lastTestInput, setLastTestInput] = useState<{ value: unknown } | undefined>(() =>
    testResult ? { value: testResult.input } : undefined,
  );
  const isSubflow = appearance.shape === 'subflow';
  const displayedTestInput = testResult ? testResult.input : lastTestInput?.value;
  const hasDisplayedTestInput = testResult !== undefined || lastTestInput !== undefined;

  useEffect(() => {
    if (initialFormState.changed) onChange(initialFormState.values);
  }, [initialFormState, onChange]);

  useEffect(() => {
    const subscription = watch((formValues) => onChange(formValues as Record<string, unknown>));
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  useEffect(() => {
    if (testResult) setLastTestInput({ value: testResult.input });
  }, [testResult]);

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
            {parameters.map((param) => {
              const liveValue = param.type === 'string' ? watch(param.name) : undefined;
              const preview =
                typeof liveValue === 'string' && hasExpressionSyntax(liveValue) ? resolveExpressionPreview(liveValue, displayedTestInput) : undefined;

              return (
                <div key={param.name}>
                  <Label className="mb-1 block" htmlFor={param.name}>{param.label}{param.required && <span className="ml-0.5 text-red-500">*</span>}</Label>
                  {param.type === 'boolean' ? (
                    <Checkbox id={param.name} {...register(param.name)} />
                  ) : param.type === 'json' ? (
                    <Controller
                      name={param.name}
                      control={control}
                      render={({ field }) => <JsonFieldEditor id={param.name} value={field.value} onChange={field.onChange} sampleJson={displayedTestInput} />}
                    />
                  ) : param.sensitive ? (
                    <div className="flex gap-1.5">
                      <Input id={param.name} type={revealed[param.name] ? 'text' : 'password'} autoComplete="off" {...register(param.name)} />
                      <button className="grid w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500" type="button" onClick={() => setRevealed((previous) => ({ ...previous, [param.name]: !previous[param.name] }))} aria-label={revealed[param.name] ? 'Hide value' : 'Show value'} aria-pressed={!!revealed[param.name]}>
                        {revealed[param.name] ? <UnlockIcon /> : <LockIcon />}
                      </button>
                    </div>
                  ) : (
                    <Input
                      id={param.name}
                      type={param.type === 'number' ? 'number' : 'text'}
                      {...register(param.name, { valueAsNumber: param.type === 'number' })}
                      className={preview ? (preview.ok ? '!border-emerald-400 focus:!border-emerald-400 focus:!ring-emerald-50' : '!border-red-400 focus:!border-red-400 focus:!ring-red-50') : ''}
                    />
                  )}
                  {preview && (
                    <p
                      className={`mb-0 mt-1 truncate text-[9px] ${preview.ok ? 'text-emerald-600' : 'text-red-600'}`}
                      data-testid={`expression-preview-${param.name}`}
                    >
                      {preview.ok ? `→ ${formatResultValue(preview.value)}` : preview.error}
                    </p>
                  )}
                  {formState.errors[param.name] && <p className="mb-0 mt-1 text-[9px] text-red-600">{String(formState.errors[param.name]?.message ?? 'Invalid value')}</p>}
                </div>
              );
            })}
            {parameters.length === 0 && <p className="m-0 text-[10px] text-slate-400">This node has no additional parameters.</p>}
          </form>
        </section>
      )}

      {!isSubflow && onTest && (
        <section className="border-b border-slate-100 p-[17px]">
          <div className="mb-[15px] flex flex-col">
            <h3 className="m-0 text-[11px] font-bold text-slate-800">Validation</h3>
            <span className="mt-0.5 text-[9px] text-slate-400">Run this node on its own with sandbox data (RF-04)</span>
          </div>
          <Button variant="outline" size="sm" onClick={onTest} disabled={isTesting}>
            {isTesting ? 'Testing…' : '▶ Test this node'}
          </Button>
          {hasDisplayedTestInput && (
            <div className="mt-3 space-y-2 text-[10px]" data-testid="node-test-result">
              <ResultField label={testResult ? 'Input' : 'Previous input'} value={displayedTestInput} />
              {testResult?.error ? (
                <p className="mb-0 rounded-md bg-red-50 px-2 py-1.5 font-semibold text-red-700" role="alert">{testResult.error}</p>
              ) : testResult ? (
                <ResultField label="Output" value={testResult.output} />
              ) : (
                <p className="mb-0 text-[9px] text-slate-400">Run the node again to refresh its output.</p>
              )}
            </div>
          )}
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

function ResultField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
      <small className="block text-[7px] font-extrabold tracking-widest text-slate-400">{label.toUpperCase()}</small>
      <pre className="mb-0 mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] text-slate-700">{formatResultValue(value)}</pre>
    </div>
  );
}

function formatResultValue(value: unknown): string {
  if (value === undefined) return '(none — no upstream connection)';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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
