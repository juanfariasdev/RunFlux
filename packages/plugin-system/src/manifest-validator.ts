import { z } from 'zod';
import type { PluginManifest } from './types';

const jsonRowOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

const jsonRowFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['text', 'select', 'typedValue']),
  initialValue: z.unknown().optional(),
  options: z.array(jsonRowOptionSchema).optional(),
  allowCustomOptions: z.boolean().optional(),
  typeKey: z.string().optional(),
  hideWhen: z.object({ key: z.string(), equals: z.unknown(), oneOf: z.array(z.unknown()).optional() }).optional(),
});

const parameterSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'json']),
  required: z.boolean(),
  default: z.unknown().optional(),
  sensitive: z.boolean().optional(),
  expressions: z.boolean().optional(),
  rowSchema: z.array(jsonRowFieldSchema).optional(),
  options: z.array(jsonRowOptionSchema).min(1).optional(),
  allowCustomOptions: z.boolean().optional(),
  showWhen: z.object({ parameter: z.string().min(1), oneOf: z.array(z.unknown()).min(1) }).optional(),
  language: z.enum(['javascript', 'sql']).optional(),
}).superRefine((parameter, context) => {
  if (parameter.language && parameter.type !== 'string') context.addIssue({ code: z.ZodIssueCode.custom, message: 'language is only supported on string parameters', path: ['language'] });
  if (!parameter.options) return;
  if (parameter.type !== 'string') context.addIssue({ code: z.ZodIssueCode.custom, message: 'options are only supported on string parameters', path: ['options'] });
  const values = parameter.options.map((option) => option.value);
  if (!parameter.allowCustomOptions && parameter.default !== undefined && !values.includes(parameter.default as string)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `default "${String(parameter.default)}" is not one of the options`, path: ['default'] });
  }
});

export const manifestSchema = z.object({
  id: z.string().min(1, 'id is required'),
  name: z.string().min(1),
  category: z.enum(['trigger', 'action', 'output', 'control-flow', 'subworkflow']),
  version: z.string().min(1),
  parameters: z.array(parameterSchema).superRefine((parameters, context) => {
    const names = parameters.map((parameter) => parameter.name);
    parameters.forEach((parameter, index) => {
      if (names.indexOf(parameter.name) !== index) context.addIssue({ code: z.ZodIssueCode.custom, message: `parameter "${parameter.name}" is declared twice`, path: [index, 'name'] });
      const condition = parameter.showWhen?.parameter;
      if (condition !== undefined && (condition === parameter.name || !names.includes(condition))) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `showWhen refers to unknown parameter "${condition}"`, path: [index, 'showWhen', 'parameter'] });
      }
    });
  }),
  supportedPlatforms: z.array(z.string().min(1)).min(1),
  outputs: z.array(z.string().min(1)).optional(),
});

export type ManifestValidationResult =
  | { success: true; manifest: PluginManifest }
  | { success: false; error: string };

/** Validates a candidate manifest object against the PluginManifest contract (RF-02, RF-04). */
export function validateManifest(candidate: unknown): ManifestValidationResult {
  const result = manifestSchema.safeParse(candidate);
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  return { success: true, manifest: result.data };
}
