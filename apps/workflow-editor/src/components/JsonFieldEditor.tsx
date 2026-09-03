import { Fragment, useRef, useState } from 'react';
import { resolveExpressions } from '@runflux/expression-engine';
import type { JsonRowFieldSchema } from '@runflux/plugin-system/types';
import { Button } from './ui/button';
import { Input } from './ui/input';

export interface JsonFieldEditorProps {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  sampleJson?: unknown;
  /** Row shape for an array-of-objects value, authored on the plugin's own parameter (rowSchema). */
  rowSchema?: JsonRowFieldSchema[];
  /** Freezes every input/button in this editor — e.g. while a webhook test is in flight. */
  disabled?: boolean;
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

/**
 * Fallback row shapes for the conventional `fields`/`conditions`/`rules`
 * parameter names, used only when a plugin's own parameter doesn't declare
 * a `rowSchema` (older manifests, ad-hoc test fixtures). Any plugin can get
 * the same structured-row treatment for a parameter of any name by declaring
 * `rowSchema` itself — see `JsonRowFieldSchema` in `@runflux/plugin-system/types`.
 */
const DEFAULT_ROW_SCHEMAS: Record<string, JsonRowFieldSchema[]> = {
  fields: [
    { key: 'name', label: 'Name', kind: 'text', initialValue: '' },
    { key: 'value', label: 'Value', kind: 'typedValue', typeKey: 'type', initialValue: '' },
    { key: 'type', label: 'Type', kind: 'text', initialValue: 'string' },
  ],
  conditions: [
    { key: 'leftValue', label: 'Left value', kind: 'text', initialValue: '' },
    { key: 'operator', label: 'Operator', kind: 'select', options: OPERATOR_OPTIONS, initialValue: 'equals' },
    {
      key: 'rightValue',
      label: 'Right value',
      kind: 'text',
      initialValue: '',
      hideWhen: { key: 'operator', equals: 'isEmpty' },
    },
  ],
  rules: [
    { key: 'combinator', label: 'Combinator', kind: 'select', options: COMBINATOR_OPTIONS, initialValue: 'and' },
    {
      key: 'conditions',
      label: 'Conditions',
      kind: 'text',
      initialValue: [{ leftValue: '', operator: 'equals', rightValue: '' }],
    },
  ],
};

/** Explicit rowSchema (from the plugin's own parameter) wins; otherwise fall back by conventional name. */
function resolveRowSchema(listId: string | undefined, rowSchema: JsonRowFieldSchema[] | undefined): JsonRowFieldSchema[] | undefined {
  if (rowSchema && rowSchema.length > 0) return rowSchema;
  return listId ? DEFAULT_ROW_SCHEMAS[listId] : undefined;
}

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
export function JsonFieldEditor({ id, value, onChange, sampleJson, rowSchema, disabled }: JsonFieldEditorProps) {
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
            disabled={disabled}
            onClick={() => setMode('fields')}
            aria-pressed={mode === 'fields'}
            className={`rounded-md px-2 py-0.5 text-[9px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'fields' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
          >
            Fields
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setMode('json');
              setJsonDraft(null);
              setJsonError(undefined);
            }}
            aria-pressed={mode === 'json'}
            className={`rounded-md px-2 py-0.5 text-[9px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'json' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
          >
            JSON
          </button>
        </div>
      )}

      {mode === 'json' || shape === 'unknown' ? (
        <>
          <textarea
            id={id}
            disabled={disabled}
            className="min-h-[88px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
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
        <ListEditor id={id} items={value as unknown[]} onChange={onChange} sampleJson={sampleJson} rowSchema={rowSchema} disabled={disabled} />
      ) : (
        <div id={id}>
          <ObjectEditor obj={value as Record<string, unknown>} onChange={onChange} sampleJson={sampleJson} disabled={disabled} />
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
  rowSchema,
  disabled,
}: {
  id: string;
  items: unknown[];
  onChange: (value: unknown) => void;
  sampleJson: unknown;
  rowSchema: JsonRowFieldSchema[] | undefined;
  disabled?: boolean;
}) {
  const effectiveRowSchema = resolveRowSchema(id, rowSchema);

  return (
    <div id={id} className="grid gap-2">
      {items.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key -- rows have no stable id of their own; index is fine since removal always re-renders the whole list.
        <div key={index} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[8px] font-bold uppercase tracking-wide text-slate-400">{id === 'fields' ? 'Field' : 'Row'} {index + 1}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              aria-label={`Remove row ${index + 1}`}
              className="text-[11px] text-red-500 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ✕
            </button>
          </div>
          <ObjectEditor
            listId={id}
            rowIndex={index}
            rowSchema={rowSchema}
            obj={item !== null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {}}
            onChange={(next) => {
              const copy = items.slice();
              copy[index] = next;
              onChange(copy);
            }}
            sampleJson={sampleJson}
            disabled={disabled}
          />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...items, createListRow(effectiveRowSchema)])} className="justify-self-start">
        {id === 'fields' ? '+ Add field' : '+ Add row'}
      </Button>
    </div>
  );
}

function createListRow(rowSchema: JsonRowFieldSchema[] | undefined): Record<string, unknown> {
  if (!rowSchema) return {};
  return Object.fromEntries(rowSchema.map(({ key, initialValue }) => [key, initialValue]));
}

/** Field keys another field's `typedValue` uses as its own type slot — rendered by that field, not on their own. */
function typeKeysOf(schema: JsonRowFieldSchema[]): Set<string> {
  return new Set(schema.filter((field) => field.kind === 'typedValue').map((field) => field.typeKey ?? 'type'));
}

/** Value patch clearing every field whose `hideWhen` just became true, mirroring the render-time hide. */
function clearedFieldsFor(schema: JsonRowFieldSchema[], changedKey: string, newValue: unknown): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of schema) {
    if (field.hideWhen && field.hideWhen.key === changedKey && field.hideWhen.equals === newValue) {
      patch[field.key] = '';
    }
  }
  return patch;
}

function ObjectEditor({
  obj,
  onChange,
  listId,
  rowIndex,
  rowSchema,
  sampleJson,
  disabled,
}: {
  obj: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  listId?: string;
  rowIndex?: number;
  rowSchema?: JsonRowFieldSchema[];
  sampleJson: unknown;
  disabled?: boolean;
}) {
  // A row inside a list whose parameter declares (or defaults to) a row schema is ALWAYS
  // edited through its structured fields below — even if this particular object's data
  // doesn't fully match yet (missing keys just render blank). Falling back on shape-mismatch
  // used to let a condition or rule row be silently "escaped" into free-form editing, where
  // its structural keys (`operator`, `leftValue`, ...) could be renamed or deleted out from
  // under it. `schema` is undefined for a map-shaped root value (headers/body — no row to
  // speak of) or a list row whose parameter declares no schema at all; either way it's still
  // the same single container below, just filled with one dynamic-key field per entry instead
  // of the schema's fixed fields — never a second, differently-built layout.
  const schema = rowIndex !== undefined ? resolveRowSchema(listId, rowSchema) : undefined;
  const typeKeys = schema ? typeKeysOf(schema) : undefined;
  const visibleFields = schema?.filter((field) => !typeKeys!.has(field.key));
  const fieldByKey = schema ? new Map(schema.map((field) => [field.key, field])) : undefined;
  const entries = Object.entries(obj);

  return (
    <div className="grid min-w-0 gap-2">
      {/* No declared schema: one card per existing key, in the same bordered-card
          language ListEditor uses for its rows — "FIELD N" + remove up top, Name/Value
          fields below, both fed through the very same <label> pattern as schema fields. */}
      {!schema && entries.map(([key, entryValue], index) => (
        // eslint-disable-next-line react/no-array-index-key -- same rationale as ListEditor.
        <div key={index} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[8px] font-bold uppercase tracking-wide text-slate-400">Field {index + 1}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                const next: Record<string, unknown> = {};
                entries.forEach(([existingKey, existingValue], i) => {
                  if (i !== index) next[existingKey] = existingValue;
                });
                onChange(next);
              }}
              aria-label={`Remove field ${index + 1}`}
              className="text-[11px] text-red-500 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ✕
            </button>
          </div>
          <div className="grid min-w-0 gap-2">
            <label className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-slate-500">
              Name
              <Input
                value={key}
                placeholder="key"
                aria-label={`Field ${index + 1} name`}
                className="!h-8 text-[10px]"
                disabled={disabled}
                onChange={(event) => {
                  const newKey = event.target.value;
                  const next: Record<string, unknown> = {};
                  entries.forEach(([existingKey, existingValue], i) => {
                    next[i === index ? newKey : existingKey] = existingValue;
                  });
                  onChange(next);
                }}
              />
            </label>
            <label className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-slate-500">
              Value
              <FieldValueEditor
                value={entryValue}
                ariaLabel={`Field ${index + 1} value`}
                sampleJson={sampleJson}
                disabled={disabled}
                onChange={(newValue) => {
                  const next: Record<string, unknown> = {};
                  entries.forEach(([existingKey, existingValue], i) => {
                    next[existingKey] = i === index ? newValue : existingValue;
                  });
                  onChange(next);
                }}
              />
            </label>
          </div>
        </div>
      ))}
      {!schema && (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange({ ...obj, '': '' })} className="justify-self-start">
          + Add field
        </Button>
      )}
      {schema && visibleFields!.map((field) => {
        const ri = rowIndex!;
        const { key, label } = field;
        const hidden = Boolean(field.hideWhen && obj[field.hideWhen.key] === field.hideWhen.equals);
        const typeKey = field.typeKey ?? 'type';
        const typeValue = obj[typeKey];
        const selectedType = isJsonValueType(typeValue) ? typeValue : getJsonValueType(obj[key]);
        const typeLabel = fieldByKey!.get(typeKey)?.label ?? 'Type';

        return hidden ? null : field.kind === 'typedValue' ? (
          <Fragment key={key}>
            <label className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-slate-500">
              {typeLabel}
              <SelectValueEditor
                value={selectedType}
                ariaLabel={`Row ${ri + 1} ${typeLabel}`}
                options={JSON_VALUE_TYPES}
                disabled={disabled}
                onChange={(nextType) => {
                  if (!isJsonValueType(nextType)) return;
                  onChange({ ...obj, [key]: convertToJsonType(obj[key], nextType), [typeKey]: nextType });
                }}
              />
            </label>
            <label className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-slate-500">
              {label}
              <TypedValueInput
                value={obj[key]}
                selectedType={selectedType}
                ariaLabel={`Row ${ri + 1} ${label}`}
                sampleJson={sampleJson}
                disabled={disabled}
                onChange={(newValue) => onChange({ ...obj, [key]: newValue, [typeKey]: selectedType })}
              />
            </label>
          </Fragment>
        ) : field.kind === 'select' ? (
          <label key={key} className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-slate-500">
            {label}
            <SelectValueEditor
              value={obj[key]}
              ariaLabel={`Row ${ri + 1} ${label}`}
              options={field.options ?? []}
              allowCustom={field.allowCustomOptions}
              disabled={disabled}
              onChange={(newValue) => onChange({
                ...obj,
                [key]: newValue,
                ...clearedFieldsFor(schema, key, newValue),
              })}
            />
          </label>
        ) : (
          <label key={key} className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-slate-500">
            {label}
            <FieldValueEditor
              value={obj[key]}
              ariaLabel={`Row ${ri + 1} ${label}`}
              sampleJson={sampleJson}
              disabled={disabled}
              onChange={(newValue) => onChange({ ...obj, [key]: newValue })}
            />
          </label>
        );
      })}
    </div>
  );
}

/** The bare value editor for a `typedValue` field — no wrapping label, no type selector; those are separate rows in ObjectEditor. */
function TypedValueInput({
  value,
  selectedType,
  onChange,
  ariaLabel,
  sampleJson,
  disabled,
}: {
  value: unknown;
  selectedType: JsonValueType;
  onChange: (value: unknown) => void;
  ariaLabel: string;
  sampleJson: unknown;
  disabled?: boolean;
}) {
  if (selectedType === 'null') {
    return <Input type="text" value="null" aria-label={ariaLabel} className="!h-8 text-[10px]" disabled />;
  }
  if (selectedType === 'boolean') {
    return (
      <SelectValueEditor
        value={value === true ? 'true' : 'false'}
        ariaLabel={ariaLabel}
        options={BOOLEAN_OPTIONS}
        disabled={disabled}
        onChange={(newValue) => onChange(newValue === 'true')}
      />
    );
  }
  return (
    <FieldValueEditor
      key={selectedType}
      value={value}
      ariaLabel={ariaLabel}
      sampleJson={sampleJson}
      conversionType={isPrimitiveType(selectedType) ? selectedType : undefined}
      containerType={isContainerType(selectedType) ? selectedType : undefined}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function SelectValueEditor({
  value,
  onChange,
  ariaLabel,
  options,
  allowCustom,
  disabled,
}: {
  value: unknown;
  onChange: (value: string) => void;
  ariaLabel: string;
  options: Array<{ value: string; label: string }>;
  allowCustom?: boolean;
  disabled?: boolean;
}) {
  const currentValue = typeof value === 'string' ? value : '';

  // A free-text input backed by a <datalist> — reuses the predefined options as suggestions
  // while still letting the user type any other value (004: universal operator/type fields).
  if (allowCustom) {
    const datalistId = `options-${ariaLabel.toLowerCase().replaceAll(' ', '-')}`;
    return (
      <>
        <Input
          list={datalistId}
          value={currentValue}
          aria-label={ariaLabel}
          className="!h-8 text-[10px]"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <datalist id={datalistId}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </datalist>
      </>
    );
  }

  const selectedValue = options.some((option) => option.value === currentValue) ? currentValue : options[0]?.value;

  return (
    <select
      value={selectedValue}
      aria-label={ariaLabel}
      disabled={disabled}
      className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-700 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
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

function isJsonValueType(value: unknown): value is JsonValueType {
  return JSON_VALUE_TYPES.some((option) => option.value === value);
}

function isContainerType(value: JsonValueType): value is 'array' | 'object' {
  return value === 'array' || value === 'object';
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
  containerType,
  disabled,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  ariaLabel: string;
  sampleJson: unknown;
  conversionType?: PrimitiveType;
  containerType?: 'array' | 'object';
  disabled?: boolean;
}) {
  if (!isPrimitive(value)) {
    return <JsonLeafInput value={value} onChange={onChange} ariaLabel={ariaLabel} requiredShape={containerType} disabled={disabled} />;
  }

  return <ValueInput value={value} onChange={onChange} ariaLabel={ariaLabel} sampleJson={sampleJson} conversionType={conversionType} disabled={disabled} />;
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
  disabled,
}: {
  value: Primitive;
  onChange: (value: unknown) => void;
  ariaLabel: string;
  sampleJson: unknown;
  conversionType?: PrimitiveType;
  disabled?: boolean;
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
        disabled={disabled}
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
function JsonLeafInput({
  value,
  onChange,
  ariaLabel,
  requiredShape,
  disabled,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  ariaLabel: string;
  requiredShape?: 'array' | 'object';
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const text = draft ?? JSON.stringify(value);

  return (
    <div className="min-w-0 flex-1">
      <Input
        type="text"
        value={text}
        aria-label={ariaLabel}
        aria-invalid={Boolean(error)}
        disabled={disabled}
        className={`!h-8 flex-1 font-mono text-[10px] ${error ? '!border-red-400' : ''}`}
        onChange={(event) => {
          const nextText = event.target.value;
          setDraft(nextText);
          try {
            const parsed = JSON.parse(nextText);
            if (requiredShape === 'array' && !Array.isArray(parsed)) {
              setError('Value must be an array');
              return;
            }
            if (requiredShape === 'object' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
              setError('Value must be an object');
              return;
            }
            setError(undefined);
            onChange(parsed);
          } catch {
            setError('Invalid JSON');
          }
        }}
      />
      {error && <p className="mb-0 mt-1 text-[9px] text-red-600" role="alert">{error}</p>}
    </div>
  );
}
