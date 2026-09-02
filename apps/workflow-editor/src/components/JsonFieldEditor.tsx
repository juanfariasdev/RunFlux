import { useState } from 'react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';

export interface JsonFieldEditorProps {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
}

type Shape = 'list' | 'map' | 'unknown';
type Mode = 'json' | 'fields';

function detectShape(value: unknown): Shape {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'list';
    return value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) ? 'list' : 'unknown';
  }
  if (value !== null && typeof value === 'object') return 'map';
  return 'unknown';
}

/**
 * Editor for a `type: 'json'` parameter (004-core-nodes-catalog, E002).
 * Toggles between the raw JSON textarea (always available) and a
 * field-by-field form, inferred at render time from the current value's own
 * shape — an array of objects becomes a list of rows, a plain object becomes
 * a key/value list. No per-plugin schema is involved: this stays generic
 * across `conditions`/`fields`/`rules`/`headers`/`body`.
 */
export function JsonFieldEditor({ id, value, onChange }: JsonFieldEditorProps) {
  const shape = detectShape(value);
  const [mode, setMode] = useState<Mode>(shape === 'unknown' ? 'json' : 'fields');
  const [jsonDraft, setJsonDraft] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | undefined>();

  const jsonText = jsonDraft ?? JSON.stringify(value ?? null, null, 2);

  return (
    <div>
      {shape !== 'unknown' && (
        <div className="mb-1.5 flex gap-1" role="group" aria-label="Edit mode">
          <button
            type="button"
            onClick={() => setMode('fields')}
            aria-pressed={mode === 'fields'}
            className={`rounded-md px-2 py-0.5 text-[9px] font-bold transition ${mode === 'fields' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
          >
            Fields
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('json');
              setJsonDraft(null);
              setJsonError(undefined);
            }}
            aria-pressed={mode === 'json'}
            className={`rounded-md px-2 py-0.5 text-[9px] font-bold transition ${mode === 'json' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
          >
            JSON
          </button>
        </div>
      )}

      {mode === 'json' || shape === 'unknown' ? (
        <>
          <textarea
            id={id}
            className="min-h-[88px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
            value={jsonText}
            onChange={(event) => {
              const text = event.target.value;
              setJsonDraft(text);
              try {
                const parsed = JSON.parse(text);
                setJsonError(undefined);
                onChange(parsed);
              } catch {
                setJsonError('Invalid JSON');
              }
            }}
          />
          {jsonError && (
            <p className="mb-0 mt-1 text-[9px] text-red-600" role="alert">
              {jsonError}
            </p>
          )}
        </>
      ) : shape === 'list' ? (
        <ListEditor id={id} items={value as unknown[]} onChange={onChange} />
      ) : (
        <div id={id}>
          <ObjectEditor obj={value as Record<string, unknown>} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function ListEditor({ id, items, onChange }: { id: string; items: unknown[]; onChange: (value: unknown) => void }) {
  return (
    <div id={id} className="grid gap-2">
      {items.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key -- rows have no stable id of their own; index is fine since removal always re-renders the whole list.
        <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[8px] font-bold uppercase tracking-wide text-slate-400">Row {index + 1}</span>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              aria-label={`Remove row ${index + 1}`}
              className="text-[11px] text-red-500 hover:text-red-600"
            >
              ✕
            </button>
          </div>
          <ObjectEditor
            obj={item !== null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {}}
            onChange={(next) => {
              const copy = items.slice();
              copy[index] = next;
              onChange(copy);
            }}
          />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, {}])} className="justify-self-start">
        + Add row
      </Button>
    </div>
  );
}

function ObjectEditor({ obj, onChange }: { obj: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const entries = Object.entries(obj);

  return (
    <div className="grid gap-1.5">
      {entries.map(([key, entryValue], index) => (
        // eslint-disable-next-line react/no-array-index-key -- same rationale as ListEditor.
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={key}
            placeholder="key"
            aria-label={`Field ${index + 1} name`}
            className="!h-8 w-[92px] shrink-0 text-[10px]"
            onChange={(event) => {
              const newKey = event.target.value;
              const next: Record<string, unknown> = {};
              entries.forEach(([existingKey, existingValue], i) => {
                next[i === index ? newKey : existingKey] = existingValue;
              });
              onChange(next);
            }}
          />
          <ValueInput
            value={entryValue}
            ariaLabel={`Field ${index + 1} value`}
            onChange={(newValue) => {
              const next: Record<string, unknown> = {};
              entries.forEach(([existingKey, existingValue], i) => {
                next[existingKey] = i === index ? newValue : existingValue;
              });
              onChange(next);
            }}
          />
          <button
            type="button"
            onClick={() => {
              const next: Record<string, unknown> = {};
              entries.forEach(([existingKey, existingValue], i) => {
                if (i !== index) next[existingKey] = existingValue;
              });
              onChange(next);
            }}
            aria-label={`Remove field ${index + 1}`}
            className="shrink-0 text-[11px] text-red-500 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...obj, '': '' })} className="justify-self-start">
        + Add field
      </Button>
    </div>
  );
}

function ValueInput({ value, onChange, ariaLabel }: { value: unknown; onChange: (value: unknown) => void; ariaLabel: string }) {
  if (typeof value === 'boolean') {
    return <Checkbox checked={value} onChange={(event) => onChange(event.target.checked)} aria-label={ariaLabel} />;
  }
  if (typeof value === 'number') {
    return (
      <Input
        type="number"
        value={value}
        aria-label={ariaLabel}
        className="!h-8 flex-1 text-[10px]"
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    );
  }
  if (value === null || value === undefined || typeof value === 'string') {
    return (
      <Input
        type="text"
        value={typeof value === 'string' ? value : ''}
        placeholder="value or {{ }}"
        aria-label={ariaLabel}
        className="!h-8 flex-1 text-[10px]"
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return <JsonLeafInput value={value} onChange={onChange} ariaLabel={ariaLabel} />;
}

/** Fallback cell for a nested object/array value inside a row — kept flat, not recursed further. */
function JsonLeafInput({ value, onChange, ariaLabel }: { value: unknown; onChange: (value: unknown) => void; ariaLabel: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const text = draft ?? JSON.stringify(value);

  return (
    <Input
      type="text"
      value={text}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      className={`!h-8 flex-1 font-mono text-[10px] ${invalid ? '!border-red-400' : ''}`}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        try {
          const parsed = JSON.parse(text);
          setInvalid(false);
          onChange(parsed);
        } catch {
          setInvalid(true);
        }
      }}
    />
  );
}
