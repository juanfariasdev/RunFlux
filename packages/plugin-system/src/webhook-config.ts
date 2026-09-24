export interface WebhookConfig {
  path: string;
  method: string;
  authentication: string;
  headerName: string;
  secretEnvVar: string;
  rawBody: boolean;
}

export function getWebhookConfig(params: Record<string, unknown>): WebhookConfig {
  const method = String(params.httpMethod || 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY'].includes(method)) throw new Error(`Invalid webhook method "${method}"`);
  const authentication = String(params.authentication || params.auth || 'none');
  if (!['none', 'secret', 'headerAuth'].includes(authentication)) throw new Error(`Invalid webhook authentication "${authentication}"`);
  const path = String(params.path || '/webhook');
  if (!path.startsWith('/') || /[?#\s]/.test(path)) throw new Error('Webhook path must be an absolute URL path without query or fragment');
  return { path, method, authentication, headerName: String(params.headerName || 'X-Webhook-Secret'), secretEnvVar: String(params.secretEnvVar || 'WEBHOOK_SECRET'), rawBody: Boolean(params.rawBody) };
}
