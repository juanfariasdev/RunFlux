import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { manifestSchema } from '../manifest-validator.js';
import type { PluginManifest } from '../types.js';

/** Ignores `readonly`: the interfaces accept readonly arrays, and the schema's output fits them. */
type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;

describe('the plugin manifest contract', () => {
  // zod drops keys its schema does not know, so a field declared only in the interfaces would
  // vanish from every discovered manifest. Type-checking this test keeps both definitions equal.
  it('is the same in the TypeScript interfaces and the zod schema', () => {
    expectTypeOf<Mutable<z.infer<typeof manifestSchema>>>().toEqualTypeOf<Mutable<PluginManifest>>();
  });
});
