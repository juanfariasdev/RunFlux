import type { WorkflowDefinition } from '@runflux/workflow-model';
import { getWebhookConfig } from '@runflux/plugin-system/webhook-config';

export function buildLocalApp(workflow: WorkflowDefinition, projectName: string): string {
  const webhooks = workflow.nodes.filter((node) => node.pluginId === 'trigger-webhook').map((node) => ({ nodeId: node.id, ...getWebhookConfig(node.parameters) }));
  return `import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { runWorkflow } from './runner.js';

export const app = express();
app.use(cors());
app.get('/health', (_req, res) => res.json({ status: 'ok', project: ${JSON.stringify(projectName)}, workflowId: ${JSON.stringify(workflow.id)}, nodeCount: ${workflow.nodes.length} }));
const webhooks = ${JSON.stringify(webhooks)};
for (const webhook of webhooks) {
  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    if (webhook.authentication !== 'none') {
      const secret = process.env[webhook.secretEnvVar];
      if (!secret || req.get(webhook.headerName) !== secret) { res.status(401).json({ error: 'Unauthorized' }); return; }
    }
    next();
  };
  const parse = webhook.rawBody ? express.text({ type: '*/*', limit: '1mb' }) : express.json({ limit: '1mb' });
  const handle = async (req: Request, res: Response) => {
    try {
      const result = await runWorkflow({ body: req.body, headers: req.headers, query: req.query }, webhook.nodeId);
      res.status(result.success ? 200 : 500).json(result);
    } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
  };
  const route = app.route(webhook.path);
  const method = (webhook.method === 'ANY' ? 'all' : webhook.method.toLowerCase()) as 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'all';
  route[method](authenticate, parse, handle);
}
${webhooks.length ? '' : `app.post('/api/execute', express.json(), async (req, res) => {
  try { const result = await runWorkflow(req.body ?? {}); res.status(result.success ? 200 : 500).json(result); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});`}
`;
}
