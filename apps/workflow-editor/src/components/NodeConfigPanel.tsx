import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { PluginManifest } from '@runflux/plugin-system/types';
import { buildZodSchema } from '../forms/build-zod-schema';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Label } from './ui/label';

export interface NodeConfigPanelProps {
  manifest: PluginManifest;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  onClose: () => void;
}

/**
 * Renders the configuration form for a node from its plugin manifest (RF-04).
 * Every change is written straight through to the store (RF-12/RN-04: saving
 * with empty required fields is always allowed — this form never blocks
 * typing or closing, only the "Testar" action in Toolbar.tsx validates).
 */
export function NodeConfigPanel({ manifest, values, onChange, onClose }: NodeConfigPanelProps) {
  const schema = buildZodSchema(manifest.parameters);
  const { register, watch, formState } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: values,
    mode: 'onChange',
  });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const subscription = watch((formValues) => onChange(formValues as Record<string, unknown>));
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4" aria-label="Node configuration">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{manifest.name}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
          ✕
        </Button>
      </div>
      <form className="space-y-3" onSubmit={(event) => event.preventDefault()}>
        {manifest.parameters.map((param) => (
          <div key={param.name}>
            <Label htmlFor={param.name}>
              {param.label}
              {param.required && <span className="ml-0.5 text-red-500">*</span>}
            </Label>
            {param.type === 'boolean' ? (
              <Checkbox id={param.name} {...register(param.name)} />
            ) : param.sensitive ? (
              <div className="flex items-center gap-1">
                <Input
                  id={param.name}
                  type={revealed[param.name] ? 'text' : 'password'}
                  autoComplete="off"
                  {...register(param.name)}
                />
                <button
                  type="button"
                  onClick={() => setRevealed((prev) => ({ ...prev, [param.name]: !prev[param.name] }))}
                  aria-label={revealed[param.name] ? 'Hide value' : 'Show value'}
                  aria-pressed={!!revealed[param.name]}
                  className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  {revealed[param.name] ? <UnlockIcon /> : <LockIcon />}
                </button>
              </div>
            ) : (
              <Input
                id={param.name}
                type={param.type === 'number' ? 'number' : 'text'}
                {...register(param.name, { valueAsNumber: param.type === 'number' })}
              />
            )}
            {formState.errors[param.name] && (
              <p className="mt-1 text-xs text-red-600">{String(formState.errors[param.name]?.message ?? 'Invalid value')}</p>
            )}
          </div>
        ))}
        {manifest.parameters.length === 0 && (
          <p className="text-sm text-slate-500">This node has no configurable parameters.</p>
        )}
      </form>
    </aside>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.4-2" />
    </svg>
  );
}
