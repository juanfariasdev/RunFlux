import type { WorkflowDefinition } from '@runflux/workflow-model';
import { getWebhookConfig } from '@runflux/plugin-system/webhook-config';

export function buildAwsHandler(workflow: WorkflowDefinition): string {
  const webhooks = workflow.nodes.filter((node) => node.pluginId === 'trigger-webhook').map((node) => ({ nodeId: node.id, ...getWebhookConfig(node.parameters) }));
  return `import { runWorkflow } from './runner.js';
const webhooks = ${JSON.stringify(webhooks)};
const response = (statusCode: number, value: unknown) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});

export async function handler(event: any) {
  try {
    const isHttp = Boolean(event?.requestContext?.http || event?.rawPath);
    let triggerId: string | undefined = isHttp ? undefined : event?.runfluxTriggerId;
    let payload: unknown = event;
    if (isHttp && webhooks.length) {
      const routes = webhooks.filter((webhook) => webhook.path === event.rawPath);
      if (!routes.length) return response(404, { error: 'Webhook not found' });
      const method = (event.requestContext?.http?.method || 'POST').toUpperCase();
      const webhook = routes.find((route) => route.method === 'ANY' || route.method === method);
      if (!webhook) return response(405, { error: 'Method not allowed' });
      const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
      if (webhook.authentication !== 'none') {
        const secret = process.env[webhook.secretEnvVar];
        if (!secret || headers[webhook.headerName.toLowerCase()] !== secret) return response(401, { error: 'Unauthorized' });
      }
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
      let body = raw;
      if (!webhook.rawBody && typeof raw === 'string' && raw) {
        try { body = JSON.parse(raw); } catch { return response(400, { error: 'Invalid JSON body' }); }
      }
      payload = { body: body ?? {}, headers, query: event.queryStringParameters || {} };
      triggerId = webhook.nodeId;
    } else if (isHttp) {
      try { payload = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {}; }
      catch { return response(400, { error: 'Invalid JSON body' }); }
    }
    const execution = await runWorkflow(payload, triggerId);
    return response(execution.success ? 200 : 500, execution);
  } catch (error) {
    return response(500, { success: false, error: error instanceof Error ? error.message : String(error) });
  }
}
`;
}
