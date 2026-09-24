import type { WorkflowDefinition, WorkflowEnvVar } from '@runflux/workflow-model';
import { getWebhookConfig } from '@runflux/plugin-system/webhook-config';
import type { CompilationOptions } from '../types.js';

/** Collect deployment settings once, including every plugin-specific secret. */
export function getEnvironmentVariables(workflow: WorkflowDefinition, options?: CompilationOptions): WorkflowEnvVar[] {
  const variables = new Map<string, WorkflowEnvVar>();
  for (const node of workflow.nodes) {
    if (node.pluginId === 'trigger-webhook') {
      const config = getWebhookConfig(node.parameters);
      if (config.authentication !== 'none') variables.set(config.secretEnvVar, { key: config.secretEnvVar });
    } else if (node.pluginId === 'database-query') {
      const key = String(node.parameters.connectionEnvVar || 'DATABASE_URL');
      variables.set(key, { key });
    }
  }
  for (const variable of options?.envVars ?? workflow.settings?.envVars ?? []) {
    variables.set(variable.key, variable);
  }
  return [...variables.values()];
}
