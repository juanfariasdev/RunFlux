import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { compileWorkflow } from '../packages/compiler/src/compiler.js';
import * as cronPlugin from '../plugins/trigger-cron/index.js';
import * as webhookPlugin from '../plugins/trigger-webhook/index.js';
import * as setPlugin from '../plugins/set/index.js';
import * as logPlugin from '../plugins/log-output/index.js';
import * as esbuild from 'esbuild';

const resolver = (id: string): any => {
  switch (id) {
    case 'trigger-cron': return cronPlugin;
    case 'trigger-webhook': return webhookPlugin;
    case 'set': return setPlugin;
    case 'log-output': return logPlugin;
    default: return undefined;
  }
};

const outputBase = path.resolve(process.cwd(), 'output-backends', 'triggers-test');

async function testCronWorkflow() {
  console.log('\n======================================================');
  console.log('⏰ TEST 1: Scheduled Cron Workflow (Local & AWS)');
  console.log('======================================================');

  const cronWf: WorkflowDefinition = {
    id: 'wf-cron-e2e',
    name: 'Scheduled Data Sync',
    nodes: [
      {
        id: 'node-cron',
        pluginId: 'trigger-cron',
        pluginVersion: '1.0.0',
        parameters: {
          expression: '*/10 * * * *',
          timezone: 'UTC',
        },
        position: { x: 0, y: 0 },
      },
      {
        id: 'node-set',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'status', value: 'synced', type: 'string' },
            { name: 'source', value: 'cron-worker', type: 'string' },
          ],
        },
        position: { x: 150, y: 0 },
      },
    ],
    connections: [
      {
        sourceNodeId: 'node-cron',
        sourceOutput: 'main',
        targetNodeId: 'node-set',
        targetInput: 'main',
      },
    ],
  };

  // Compile Local
  const localResult = await compileWorkflow(
    { workflow: cronWf, targetPlatform: 'local', projectName: 'Cron Local E2E' },
    resolver
  );
  if (localResult.status !== 'success') {
    throw new Error('Local cron compilation failed');
  }

  const cronDir = path.join(outputBase, 'cron-local');
  await fs.promises.mkdir(cronDir, { recursive: true });
  for (const f of localResult.files) {
    const p = path.join(cronDir, f.path);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, f.content, 'utf8');
  }

  // Bundle with esbuild
  const distDir = path.join(cronDir, 'dist');
  await fs.promises.mkdir(distDir, { recursive: true });
  await esbuild.build({
    entryPoints: [
      path.join(cronDir, 'src', 'server.ts'),
      path.join(cronDir, 'src', 'run.ts'),
      path.join(cronDir, 'src', 'run-cron.ts'),
    ],
    bundle: true,
    format: 'esm',
    splitting: true,
    packages: 'external',
    outExtension: { '.js': '.mjs' },
    platform: 'node',
    target: 'node24',
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    outdir: distDir,
  });

  console.log('✅ Cron project compiled and bundled successfully:');
  console.log('   - src/run-cron.ts generated');
  console.log('   - dist/run-cron.mjs produced by esbuild');

  // Verify AWS CDK EventBridge rule
  const awsResult = await compileWorkflow(
    { workflow: cronWf, targetPlatform: 'aws', projectName: 'Cron AWS E2E' },
    resolver
  );
  if (awsResult.status !== 'success') {
    throw new Error('AWS cron compilation failed');
  }
  const stackFile = awsResult.files.find((f) => f.path === 'lib/workflow-stack.ts');
  if (!stackFile || !stackFile.content.includes('WorkflowCronRule')) {
    throw new Error('Expected EventBridge rule WorkflowCronRule in CDK stack');
  }
  console.log('✅ AWS EventBridge cron rule generated in lib/workflow-stack.ts');
}

async function testWebhookWorkflow() {
  console.log('\n======================================================');
  console.log('⚡ TEST 2: Synchronous Webhook Workflow with Secret Auth');
  console.log('======================================================');

  const webhookWf: WorkflowDefinition = {
    id: 'wf-webhook-e2e',
    name: 'Customer Order Webhook',
    nodes: [
      {
        id: 'node-webhook',
        pluginId: 'trigger-webhook',
        pluginVersion: '1.0.0',
        parameters: {
          path: '/webhook/orders',
          httpMethod: 'POST',
          auth: 'secret',
          secretEnvVar: 'TEST_WEBHOOK_SECRET',
        },
        position: { x: 0, y: 0 },
      },
      {
        id: 'node-set',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'orderReceived', value: true, type: 'boolean' },
            { name: 'notificationStatus', value: 'dispatched', type: 'string' },
          ],
        },
        position: { x: 150, y: 0 },
      },
    ],
    connections: [
      {
        sourceNodeId: 'node-webhook',
        sourceOutput: 'main',
        targetNodeId: 'node-set',
        targetInput: 'main',
      },
    ],
  };

  // Compile Local
  const localResult = await compileWorkflow(
    { workflow: webhookWf, targetPlatform: 'local', projectName: 'Webhook Local E2E' },
    resolver
  );
  if (localResult.status !== 'success') {
    throw new Error('Local webhook compilation failed');
  }

  const webhookDir = path.join(outputBase, 'webhook-local');
  await fs.promises.mkdir(webhookDir, { recursive: true });
  for (const f of localResult.files) {
    const p = path.join(webhookDir, f.path);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, f.content, 'utf8');
  }

  // Bundle with esbuild
  const distDir = path.join(webhookDir, 'dist');
  await fs.promises.mkdir(distDir, { recursive: true });
  await esbuild.build({
    entryPoints: [
      path.join(webhookDir, 'src', 'server.ts'),
      path.join(webhookDir, 'src', 'run.ts'),
    ],
    bundle: true,
    format: 'esm',
    splitting: true,
    packages: 'external',
    outExtension: { '.js': '.mjs' },
    platform: 'node',
    target: 'node24',
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    outdir: distDir,
  });

  console.log('✅ Webhook project compiled and bundled successfully in dist/');

  // Launch live Express server on port 4891
  const port = 4891;
  const expectedSecret = 'secret-token-12345';
  const serverProcess = spawn('node', [path.join(distDir, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), TEST_WEBHOOK_SECRET: expectedSecret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), 5000);
    serverProcess.stdout?.on('data', (data) => {
      if (data.toString().includes('Compiled server running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProcess.on('error', reject);
  });

  console.log(`✅ Live Express server started on http://localhost:${port}`);

  try {
    // 1. Health check
    const health = await makeRequest(port, '/health', 'GET');
    if (health.status !== 200 || health.data.status !== 'ok') {
      throw new Error(`Health check failed: ${JSON.stringify(health)}`);
    }
    console.log('   - GET /health returned 200 OK');

    // 2. Call Webhook without secret -> expect 401
    const unauth = await makeRequest(port, '/webhook/orders', 'POST', { item: 'Laptop' });
    if (unauth.status !== 401) {
      throw new Error(`Expected 401 Unauthorized without secret, got ${unauth.status}`);
    }
    console.log('   - POST /webhook/orders without secret correctly rejected: 401 Unauthorized');

    // 3. Call Webhook with valid secret -> expect 200 and synchronous response
    const authCall = await makeRequest(
      port,
      '/webhook/orders',
      'POST',
      { customerId: 'cust-99', total: 450 },
      { 'x-webhook-secret': expectedSecret }
    );
    if (authCall.status !== 200 || !authCall.data.success) {
      throw new Error(`Expected 200 with success: true, got ${authCall.status}`);
    }
    if (!authCall.data.result?.orderReceived || authCall.data.result?.notificationStatus !== 'dispatched') {
      throw new Error(`Workflow output incomplete: ${JSON.stringify(authCall.data)}`);
    }
    console.log('   - POST /webhook/orders with X-Webhook-Secret responded synchronously: 200 OK');
    console.log('   - Pipeline result:', JSON.stringify(authCall.data.result));

  } finally {
    serverProcess.kill('SIGTERM');
  }

  // Test AWS Lambda handler with secret
  const awsResult = await compileWorkflow(
    { workflow: webhookWf, targetPlatform: 'aws', projectName: 'Webhook AWS E2E' },
    resolver
  );
  if (awsResult.status !== 'success') {
    throw new Error('AWS webhook compilation failed');
  }
  const handlerFile = awsResult.files.find((f) => f.path === 'src/handler.ts');
  if (!handlerFile || !handlerFile.content.includes('TEST_WEBHOOK_SECRET')) {
    throw new Error('Expected secret check in AWS Lambda handler');
  }
  console.log('✅ AWS Lambda handler includes secret authentication check');
}

function makeRequest(
  port: number,
  pathName: string,
  method: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathName,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let data = raw;
          try {
            data = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode || 0, data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('🚀 Starting Triggers Catalog E2E Test Suite (Cron & Webhook)');
  try {
    await testCronWorkflow();
    await testWebhookWorkflow();
    console.log('\n🎉 ALL TRIGGER CATALOG E2E TESTS PASSED SUCCESSFULLY! (100% GREEN)');
  } finally {
    // Cleanup test artifacts
    if (fs.existsSync(outputBase)) {
      await fs.promises.rm(outputBase, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
