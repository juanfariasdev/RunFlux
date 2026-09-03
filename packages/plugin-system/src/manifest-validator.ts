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
  hideWhen: z.object({ key: z.string(), equals: z.unknown() }).optional(),
});

const parameterSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'json']),
  required: z.boolean(),
  default: z.unknown().optional(),
  sensitive: z.boolean().optional(),
  rowSchema: z.array(jsonRowFieldSchema).optional(),
});

const manifestSchema = z.object({
  id: z.string().min(1, 'id is required'),
  name: z.string().min(1),
  category: z.enum(['trigger', 'action', 'output', 'control-flow', 'subworkflow']),
  version: z.string().min(1),
  parameters: z.array(parameterSchema),
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
