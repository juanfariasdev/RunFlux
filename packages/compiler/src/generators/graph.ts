import type { WorkflowDefinition } from '@runflux/workflow-model';
import type { CompiledNodeEntry, GeneratedFile } from '../types.js';
import { buildRunnerCode } from './templates/runner-template.js';

/** The compiler binds node IDs to artifacts explicitly; platform templates never guess by filename. */
export function generateGraphRunner(workflow: WorkflowDefinition, nodeFiles: GeneratedFile[], entries?: Record<string, CompiledNodeEntry>): string {
  const imports: string[] = [];
  const nodes = workflow.nodes.map((node, index) => {
    const entry = entries?.[node.id];
    const file = entry?.path ?? nodeFiles[index]?.path;
    if (!file) throw new Error(`Missing generated entrypoint for node "${node.id}"`);
    const modulePath = file.replace(/^src\//, './').replace(/\.ts$/, '.js');
    imports.push(`import * as nodeModule_${index} from ${JSON.stringify(modulePath)};`);
    return `  {
    id: ${JSON.stringify(node.id)},
    name: ${JSON.stringify(node.appearance?.label || node.id)},
    isTrigger: ${entry?.isTrigger ?? node.pluginId.startsWith('trigger-')},
    outputs: ${JSON.stringify(entry?.outputs) ?? 'undefined'},
    run: (input, context) => nodeModule_${index}.run(input, context),
  }`;
  });
  const connections = workflow.connections.map((c) => ({
    source: c.sourceNodeId, sourceOutput: c.sourceOutput || 'main',
    target: c.targetNodeId, targetInput: c.targetInput || 'main',
  }));
  return buildRunnerCode(imports, nodes.join(',\n'), JSON.stringify(connections, null, 2));
}
