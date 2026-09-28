import { z } from 'zod';
import { WORKFLOW_SCHEMA_VERSION } from './version';

/*
 * The shapes RunFlux accepts from outside (the editor's API requests, imported project files and
 * the examples), validated with zod. The project server and the compiler service read them from
 * here, so every entry point validates a workflow the same way.
 */

/** A node as a request sends it; the plugin version and parameters get defaults. */
export const workflowNodeSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  pluginVersion: z.string().optional().default('1.0.0'),
  parameters: z.record(z.unknown()).default({}),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  parentId: z.string().optional(),
  appearance: z
    .object({
      label: z.string().optional(),
      color: z.string().optional(),
      shape: z.enum(['card', 'rounded', 'pill', 'diamond', 'subflow']).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional(),
});

/** A connection as a request sends it; both ports default to `main`. */
export const workflowConnectionSchema = z.object({
  sourceNodeId: z.string(),
  sourceOutput: z.string().default('main'),
  targetNodeId: z.string(),
  targetInput: z.string().default('main'),
  label: z.string().optional(),
  animated: z.boolean().optional(),
  type: z.enum(['smoothstep', 'bezier', 'straight']).optional(),
  color: z.string().optional(),
});

/**
 * A workflow as a request sends it. The id and name are optional (the server assigns them) and
 * unknown keys, such as `settings`, are dropped unless the caller uses `.passthrough()`.
 */
export const workflowDefinitionSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  nodes: z.array(workflowNodeSchema).default([]),
  connections: z.array(workflowConnectionSchema).default([]),
});

/** A project variable; its name must work in shells, .env files, Docker and Lambda. */
export const envVarItemSchema = z.object({
  key: z
    .string()
    .min(1, 'Nome da variável não pode ser vazio')
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Nome da variável deve ser um identificador válido (ex: API_KEY)'),
  value: z.string().default(''),
  description: z.string().optional(),
});

export const envVarsArraySchema = z.array(envVarItemSchema);

/** One entry of a variables update. A value is sent only when it changes; without one, the stored value stays. */
export const envVarUpdateSchema = z.object({
  key: envVarItemSchema.shape.key,
  value: z.string().optional(),
  description: z.string().optional(),
});

/** A variables update: the whole list, each name at most once. */
export const envVarUpdatesSchema = z.array(envVarUpdateSchema).superRefine((updates, context) => {
  const seen = new Set<string>();
  updates.forEach((update, index) => {
    if (seen.has(update.key)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'key'], message: `Variável '${update.key}' repetida` });
    seen.add(update.key);
  });
});

export type EnvVarUpdate = z.output<typeof envVarUpdateSchema>;

/** A project variable as the API returns it: whether it has a value, never the value. */
export interface ProjectEnvVarView {
  key: string;
  description?: string;
  hasValue: boolean;
  /** Present when the stored value cannot be decrypted with the current key. */
  unreadable?: true;
}

/** A `.runflux.json` project file, as exported and imported. */
export const runfluxEnvelopeSchema = z.object({
  $schema: z.string().optional(),
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  exportedAt: z.string(),
  project: z.object({
    name: z.string().min(1, 'Nome do projeto é obrigatório'),
    envVars: envVarsArraySchema.optional(),
  }),
  workflow: workflowDefinitionSchema,
});

/** A project variable after validation: the value defaults to empty text. */
export type ProjectEnvVar = z.output<typeof envVarItemSchema>;

/** A project file after validation. */
export type RunfluxEnvelope = z.output<typeof runfluxEnvelopeSchema>;
