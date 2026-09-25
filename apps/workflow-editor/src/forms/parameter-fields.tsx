import type { ReactNode } from 'react';
import { Controller, type Control, type UseFormRegister } from 'react-hook-form';
import type { ParameterSchema } from '@runflux/plugin-system/sdk';
import { JsonFieldEditor } from '../components/JsonFieldEditor';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';

export type ExpressionPreview = { ok: true; value: unknown } | { ok: false; error: string };

/** What a parameter's control needs from the node panel. */
export interface ParameterFieldContext {
  readonly parameter: ParameterSchema;
  readonly register: UseFormRegister<Record<string, unknown>>;
  readonly control: Control<Record<string, unknown>>;
  readonly disabled: boolean;
  /** The live evaluation of a text value holding an expression. */
  readonly preview?: ExpressionPreview;
  /** Whether a sensitive value is shown in clear, and how to toggle it. */
  readonly revealed: boolean;
  readonly onToggleReveal: () => void;
  /** The node's last test input, for previews inside structured values. */
  readonly sampleJson: unknown;
  readonly nodeScope?: Record<string, { json: unknown }>;
  readonly envScope?: Record<string, string>;
}

/** Draws the control of the parameters it matches. The first renderer that matches wins. */
export interface ParameterFieldRenderer {
  readonly matches: (parameter: ParameterSchema) => boolean;
  readonly render: (context: ParameterFieldContext) => ReactNode;
}

const checkbox: ParameterFieldRenderer = {
  matches: (parameter) => parameter.type === 'boolean',
  render: ({ parameter, register, disabled }) => <Checkbox id={parameter.name} disabled={disabled} {...register(parameter.name)} />,
};

const select: ParameterFieldRenderer = {
  matches: (parameter) => parameter.type === 'string' && Boolean(parameter.options) && !parameter.allowCustomOptions,
  render: ({ parameter, register, disabled }) => (
    <select
      id={parameter.name}
      disabled={disabled}
      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
      {...register(parameter.name)}
    >
      {parameter.options!.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
};

const suggestions: ParameterFieldRenderer = {
  matches: (parameter) => parameter.type === 'string' && Boolean(parameter.options),
  render: ({ parameter, register, disabled }) => (
    <>
      <Input id={parameter.name} list={`${parameter.name}-suggestions`} autoComplete="off" disabled={disabled} {...register(parameter.name)} />
      <datalist id={`${parameter.name}-suggestions`} data-testid={`suggestions-${parameter.name}`}>
        {parameter.options!.map((option) => (
          <option key={option.value} value={option.value} label={option.label} />
        ))}
      </datalist>
    </>
  ),
};

const json: ParameterFieldRenderer = {
  matches: (parameter) => parameter.type === 'json',
  render: ({ parameter, control, disabled, sampleJson, nodeScope, envScope }) => (
    <Controller
      name={parameter.name}
      control={control}
      render={({ field }) => <JsonFieldEditor id={parameter.name} value={field.value} onChange={field.onChange} sampleJson={sampleJson} nodeScope={nodeScope} envScope={envScope} rowSchema={parameter.rowSchema} disabled={disabled} />}
    />
  ),
};

const sensitive: ParameterFieldRenderer = {
  matches: (parameter) => Boolean(parameter.sensitive),
  render: ({ parameter, register, disabled, revealed, onToggleReveal }) => (
    <div className="flex gap-1.5">
      <Input id={parameter.name} type={revealed ? 'text' : 'password'} autoComplete="off" disabled={disabled} {...register(parameter.name)} />
      <button className="grid w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500" type="button" onClick={onToggleReveal} aria-label={revealed ? 'Hide value' : 'Show value'} aria-pressed={revealed}>
        {revealed ? <UnlockIcon /> : <LockIcon />}
      </button>
    </div>
  ),
};

const code: ParameterFieldRenderer = {
  matches: (parameter) => Boolean(parameter.language),
  render: ({ parameter, register, disabled }) => (
    <textarea
      id={parameter.name}
      rows={8}
      disabled={disabled}
      className="w-full font-mono text-xs rounded-lg border border-slate-200 bg-slate-900 text-emerald-400 p-3 shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
      placeholder={parameter.language === 'sql' ? 'SELECT * FROM users WHERE id = $1;' : '// return $json;'}
      spellCheck={false}
      {...register(parameter.name)}
    />
  ),
};

const text: ParameterFieldRenderer = {
  matches: () => true,
  render: ({ parameter, register, disabled, preview }) => (
    <Input
      id={parameter.name}
      type={parameter.type === 'number' ? 'number' : 'text'}
      disabled={disabled}
      {...register(parameter.name, { valueAsNumber: parameter.type === 'number' })}
      className={preview ? (preview.ok ? '!border-emerald-400 focus:!border-emerald-400 focus:!ring-emerald-50' : '!border-red-400 focus:!border-red-400 focus:!ring-red-50') : ''}
    />
  ),
};

/**
 * The parameter controls, most specific first. A new kind of parameter (a collection, a resource
 * locator, a credential) is one more renderer here instead of a branch in the node panel.
 */
export const PARAMETER_FIELD_RENDERERS: readonly ParameterFieldRenderer[] = [checkbox, select, suggestions, json, sensitive, code, text];

export function renderParameterField(context: ParameterFieldContext): ReactNode {
  return PARAMETER_FIELD_RENDERERS.find((renderer) => renderer.matches(context.parameter))!.render(context);
}

function LockIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}

function UnlockIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.4-2" /></svg>;
}
