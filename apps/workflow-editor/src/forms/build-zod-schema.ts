import { z, type ZodTypeAny } from 'zod';
import type { ParameterSchema } from '@runflux/plugin-system/sdk';

/**
 * Builds a Zod object schema at runtime from a plugin's declared parameters
 * (D-03). `parameters` is data (from the plugin manifest), not a static type,
 * so the schema can't be hand-written per node type — it has to be generated.
 *
 * `sensitive` does not change validation, only how the field is rendered
 * (masked) — see NodeConfigPanel.tsx.
 */
export function buildZodSchema(parameters: ParameterSchema[]): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};

  for (const param of parameters) {
    shape[param.name] = fieldSchemaFor(param.type, param.required);
  }

  return z.object(shape);
}

function fieldSchemaFor(type: ParameterSchema['type'], required: boolean): ZodTypeAny {
  switch (type) {
    case 'string':
      return required ? z.string().min(1, 'Required') : z.string().optional();
    case 'number':
      return required ? z.number() : z.number().optional();
    case 'boolean':
      return required ? z.boolean() : z.boolean().optional();
    case 'json':
      // Shape validation for JSON parameters is the plugin's own responsibility;
      // out of scope for this feature (see roadmap.md, riscos).
      return z.unknown();
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unsupported parameter type: ${String(exhaustiveCheck)}`);
    }
  }
}
