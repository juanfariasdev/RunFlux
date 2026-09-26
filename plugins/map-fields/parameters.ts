/** The parameter choices of Map Fields, shared by its manifest and its runtime. */

export const MAP_MODES = ['fields', 'value'] as const;
export type MapMode = (typeof MAP_MODES)[number];

export const ELEMENT_ERROR_POLICIES = ['fail', 'skip'] as const;
export type ElementErrorPolicy = (typeof ELEMENT_ERROR_POLICIES)[number];

export const MODE_OPTIONS = [
  { value: 'fields', label: 'Fields: one object per element' },
  { value: 'value', label: 'Value: one value per element' },
] satisfies Array<{ value: MapMode; label: string }>;

export const ELEMENT_ERROR_OPTIONS = [
  { value: 'fail', label: 'Fail the node' },
  { value: 'skip', label: 'Skip the element' },
] satisfies Array<{ value: ElementErrorPolicy; label: string }>;
