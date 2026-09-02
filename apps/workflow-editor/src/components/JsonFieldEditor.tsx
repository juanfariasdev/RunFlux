import { useRef, useState } from 'react';
import { resolveExpressions } from '@runflux/expression-engine';
import { Button } from './ui/button';
import { Input } from './ui/input';

export interface JsonFieldEditorProps {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  sampleJson?: unknown;
}

type Shape = 'list' | 'map' | 'unknown';
type Mode = 'json' | 'fields';
type Primitive = string | number | boolean | null | undefined;
type PrimitiveType = 'string' | 'number' | 'boolean' | 'null' | 'undefined';
type JsonValueType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';

const JSON_VALUE_TYPES: { value: JsonValueType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'null', label: 'Null' },
  { value: 'array', label: 'Array' },
  { value: 'object', label: 'Object' },
];

const BOOLEAN_OPTIONS = [
  { value: 'true', label: 'True' },
  { value: 'false', label: 'False' },
];

const OPERATOR_OPTIONS = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'greaterThan', label: 'Greater than' },
  { value: 'lessThan', label: 'Less than' },
  { value: 'isEmpty', label: 'Is empty' },
];

const COMBINATOR_OPTIONS = [
  { value: 'and', label: 'AND' },
  { value: 'or', label: 'OR' },
];

interface KnownField {
  key: string;
  label: string;
  initialValue: Primitive | unknown[];
}

const LIST_ROW_FIELDS: Record<string, KnownField[]> = {
  fields: [
    { key: 'name', label: 'Name', initialValue: '' },
    { key: 'value', label: 'Value', initialValue: '' },
  ],
  conditions: [
    { key: 'leftValue', label: 'Left value', initialValue: '' },
    { key: 'operator', label: 'Operator', initialValue: 'equals' },
    { key: 'rightValue', label: 'Right value', initialValue: '' },
  ],
  rules: [
    { key: 'combinator', label: 'Combinator', initialValue: 'and' },
    {
      key: 'conditions',
      label: 'Conditions',
      initialValue: [{ leftValue: '', operator: 'equals', rightValue: '' }],
    },
  ],
};

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
export function JsonFieldEditor({ id, value, onChange, sampleJson }: JsonFieldEditorProps) {
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
        <ListEditor id={id} items={value as unknown[]} onChange={onChange} sampleJson={sampleJson} />
      ) : (
        <div id={id}>
          <ObjectEditor obj={value as Record<string, unknown>} onChange={onChange} sampleJson={sampleJson} />
        </div>
      )}
    </div>
  );
}

function ListEditor({
  id,
  items,
  onChange,
  sampleJson,
}: {
  id: string;
  items: unknown[];
  onChange: (value: unknown) => void;
  sampleJson: unknown;
}) {
  return (
    <div id={id} className="grid gap-2">
      {items.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key -- rows have no stable id of their own; index is fine since removal always re-renders the whole list.
        <div key={index} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[8px] font-bold uppercase tracking-wide text-slate-400">{id === 'fields' ? 'Field' : 'Row'} {index + 1}</span>
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
            listId={id}
            rowIndex={index}
            obj={item !== null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {}}
            onChange={(next) => {
              const copy = items.slice();
              copy[index] = next;
              onChange(copy);
            }}
            sampleJson={sampleJson}
          />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, createListRow(id)])} className="justify-self-start">
        {id === 'fields' ? '+ Add field' : '+ Add row'}
      </Button>
    </div>
  );
}

function createListRow(id: string): Record<string, unknown> {
  const fields = LIST_ROW_FIELDS[id];
  if (!fields) return {};

  return Object.fromEntries(fields.map(({ key, initialValue }) => [key, initialValue]));
}

function getKnownFields(listId: string | undefined, obj: Record<string, unknown>): KnownField[] | undefined {
  const fields = listId ? LIST_ROW_FIELDS[listId] : undefined;
  if (!fields || Object.keys(obj).length !== fields.length || !fields.every(({ key }) => Object.hasOwn(obj, key))) return undefined;
  return fields;
}

function ObjectEditor({
  obj,
  onChange,
  listId,
  rowIndex,
  sampleJson,
}: {
  obj: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  listId?: string;
  rowIndex?: number;
  sampleJson: unknown;
}) {
  const entries = Object.entries(obj);
  const knownFields = getKnownFields(listId, obj);

  if (knownFields && rowIndex !== undefined) {
    return (
      <div className="grid min-w-0 gap-2">
        {knownFields.map(({ key, label }) => {
          const options = key === 'operator' ? OPERATOR_OPTIONS : key === 'combinator' ? COMBINATOR_OPTIONS : undefined;

          return listId === 'fields' && key === 'value' ? (
            <SetFieldValueEditor
              key={key}
              value={obj[key]}
              rowIndex={rowIndex}
              sampleJson={sampleJson}
              onChange={(newValue) => onChange({ ...obj, [key]: newValue })}
            />
          ) : options ? (
            <label key={key} className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-slate-500">
              {label}
              <SelectValueEditor
                value={obj[key]}
                ariaLabel={`Row ${rowIndex + 1} ${label}`}
                options={options}
                onChange={(newValue) => onChange({ ...obj, [key]: newValue })}
              />
            </label>
          ) : (
            <label key={key} className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-slate-500">
              {label}
              <FieldValueEditor
                value={obj[key]}
                ariaLabel={`Row ${rowIndex + 1} ${label}`}
                sampleJson={sampleJson}
                onChange={(newValue) => onChange({ ...obj, [key]: newValue })}
              />
            </label>
          );
        })}
      </div>
    );
  }

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
          <FieldValueEditor
            value={entryValue}
            ariaLabel={`Field ${index + 1} value`}
            sampleJson={sampleJson}
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

function SetFieldValueEditor({
  value,
  onChange,
  rowIndex,
  sampleJson,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  rowIndex: number;
  sampleJson: unknown;
}) {
  const [selectedType, setSelectedType] = useState<JsonValueType>(() => getJsonValueType(value));
  const valueLabel = `Row ${rowIndex + 1} Value`;

  return (
    <div className="grid min-w-0 gap-2">
      <label className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-slate-500">
        Type
        <select
          value={selectedType}
          aria-label={`Row ${rowIndex + 1} Type`}
          className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-700 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
          onChange={(event) => {
            const nextType = event.target.value;
            if (!isJsonValueType(nextType)) return;
            setSelectedType(nextType);
            onChange(convertToJsonType(value, nextType));
          }}
        >
          {JSON_VALUE_TYPES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-slate-500">
        Value
        {selectedType === 'null' ? (
          <Input type="text" value="null" aria-label={valueLabel} className="!h-8 text-[10px]" disabled />
        ) : selectedType === 'boolean' ? (
          <SelectValueEditor
            value={value === true ? 'true' : 'false'}
            ariaLabel={valueLabel}
            options={BOOLEAN_OPTIONS}
            onChange={(newValue) => onChange(newValue === 'true')}
          />
        ) : (
          <FieldValueEditor
            value={value}
            ariaLabel={valueLabel}
            sampleJson={sampleJson}
            conversionType={isPrimitiveType(selectedType) ? selectedType : undefined}
            onChange={onChange}
          />
        )}
      </label>
    </div>
  );
}

function SelectValueEditor({
  value,
  onChange,
  ariaLabel,
  options,
}: {
  value: unknown;
  onChange: (value: string) => void;
  ariaLabel: string;
  options: Array<{ value: string; label: string }>;
}) {
  const selectedValue = typeof value === 'string' && options.some((option) => option.value === value) ? value : options[0]?.value;

  return (
    <select
      value={selectedValue}
      aria-label={ariaLabel}
      className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-700 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function getJsonValueType(value: unknown): JsonValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'object';
  return 'string';
}

function isJsonValueType(value: string): value is JsonValueType {
  return JSON_VALUE_TYPES.some((option) => option.value === value);
}

function isPrimitiveType(value: JsonValueType): value is 'string' | 'number' | 'boolean' {
  return value === 'string' || value === 'number' || value === 'boolean';
}

function convertToJsonType(value: unknown, type: JsonValueType): unknown {
  if (type === 'null') return null;
  if (type === 'array') return Array.isArray(value) ? value : [];
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    return false;
  }
  if (type === 'number') {
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function FieldValueEditor({
  value,
  onChange,
  ariaLabel,
  sampleJson,
  conversionType,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  ariaLabel: string;
  sampleJson: unknown;
  conversionType?: PrimitiveType;
}) {
  if (!isPrimitive(value)) {
    return <JsonLeafInput value={value} onChange={onChange} ariaLabel={ariaLabel} />;
  }

  return <ValueInput value={value} onChange={onChange} ariaLabel={ariaLabel} sampleJson={sampleJson} conversionType={conversionType} />;
}

function isPrimitive(value: unknown): value is Primitive {
  return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function getPrimitiveType(value: Primitive): PrimitiveType {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'undefined';
}

function hasExpressionSyntax(value: string): boolean {
  return /\{\{[\s\S]*?\}\}/.test(value);
}

type ExpressionPreview = { ok: true; value: unknown } | { ok: false; error: string };

function resolveExpressionPreview(value: string, sampleJson: unknown): ExpressionPreview {
  try {
    return { ok: true, value: resolveExpressions({ value }, { $json: sampleJson ?? {} }).value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function formatPreviewValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function convertValue(value: string, originalType: PrimitiveType): unknown {
  if (hasExpressionSyntax(value)) return value;
  if (originalType === 'number') {
    const numberValue = Number(value);
    return value.trim() !== '' && Number.isFinite(numberValue) ? numberValue : value;
  }
  if (originalType === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

function isAllowedNumberInput(value: string): boolean {
  const text = value.trim();
  if (text === '') return true;
  if (text === '{' || text.startsWith('{{')) return true;
  if (text === '-' || text === '.' || text === '-.') return true;
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(text);
}

function convertNumberInput(value: string): unknown {
  if (isAllowedNumberInput(value)) {
    const text = value.trim();
    if (text != "" && Number.isFinite(Number(text))) {
      if (text === '-' || text === '.' || text === '-.' || text.endsWith('.')) return value;
      return Number(text);
    }
    return value;
  }
}

function ValueInput({
  value,
  onChange,
  ariaLabel,
  sampleJson,
  conversionType,
}: {
  value: Primitive;
  onChange: (value: unknown) => void;
  ariaLabel: string;
  sampleJson: unknown;
  conversionType?: PrimitiveType;
}) {
  const inferredType = useRef<PrimitiveType>(getPrimitiveType(value)).current;
  const outputType = conversionType ?? inferredType;
  const text = value === null || value === undefined ? '' : String(value);
  const preview = hasExpressionSyntax(text) ? resolveExpressionPreview(text, sampleJson) : undefined;
  const previewId = `expression-preview-${ariaLabel.toLowerCase().replaceAll(' ', '-')}`;

  return (
    <div className="min-w-0 flex-1">
      <Input
        type="text"
        inputMode={conversionType === 'number' ? 'decimal' : undefined}
        value={text}
        placeholder="value or {{ }}"
        aria-label={ariaLabel}
        className={`!h-8 text-[10px] ${preview ? (preview.ok ? '!border-emerald-400 focus:!border-emerald-400 focus:!ring-emerald-50' : '!border-red-400 focus:!border-red-400 focus:!ring-red-50') : ''}`}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (conversionType === 'number') {
            if (!isAllowedNumberInput(nextValue)) return;
            onChange(convertNumberInput(nextValue));
            return;
          }
          onChange(convertValue(nextValue, outputType));
        }}
      />
      {preview && (
        <p className={`mb-0 mt-1 truncate text-[9px] ${preview.ok ? 'text-emerald-600' : 'text-red-600'}`} data-testid={previewId}>
          {preview.ok ? `→ ${formatPreviewValue(preview.value)}` : preview.error}
        </p>
      )}
    </div>
  );
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
